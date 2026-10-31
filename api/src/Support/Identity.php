<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * D'où vient l'identité de la requête, et laquelle.
 *
 * Trois sources, dans cet ordre :
 *
 * 1. **service** — un autre module du même serveur (Social, cockpit) qui lit ou
 *    écrit par cette API. Il présente `X-Marketing-Service`, comparé en temps
 *    constant à `MAR_SERVICE_TOKEN` ; il agit au niveau du réseau.
 * 2. **erp** — une personne connectée par ses identifiants de l'ERP : le cookie
 *    signé de `Session`, qui porte son rôle et ses boutiques.
 * 3. **dev** — l'identité de développement, si et seulement si `MAR_DEV_AUTH=1`.
 *    Les en-têtes `X-Dev-*` priment, sinon `MAR_DEV_USER_ID`. À ne jamais laisser
 *    en production : n'importe qui y entre en BRAND_ADMIN.
 *
 * Aucune ne s'applique : pas d'identité, et toute route non publique répond 401.
 */
final class Identity
{
    private static ?string $source = null;

    /**
     * @param array<string,mixed> $server  `$_SERVER`
     * @param array<string,mixed> $cookies `$_COOKIE`
     * @return 'service'|'erp'|'dev'|null
     */
    public static function resolve(array $server, array $cookies): ?string
    {
        AuthContext::clear();
        self::$source = null;

        $token   = (string) Env::get('MAR_SERVICE_TOKEN', '');
        $offered = (string) ($server['HTTP_X_MARKETING_SERVICE'] ?? '');
        if ($offered !== '') {
            // Un jeton présenté et faux ne retombe pas sur une autre source : c'est une erreur, pas un visiteur.
            if (strlen($token) >= 32 && hash_equals($token, $offered)) {
                AuthContext::set(0, 'BRAND_ADMIN', null);
                return self::$source = 'service';
            }
            return null;
        }

        $cookie = (string) ($cookies[Session::COOKIE] ?? '');
        if ($cookie !== '') {
            $identity = Session::open($cookie);
            if ($identity !== null) {
                AuthContext::set($identity['user_id'], $identity['role'], null, $identity['shop_ids']);
                return self::$source = 'erp';
            }
        }

        if (Env::get('MAR_DEV_AUTH') === '1') {
            $userId = (int) ($server['HTTP_X_DEV_USER_ID'] ?? Env::get('MAR_DEV_USER_ID', '0'));
            $role   = (string) ($server['HTTP_X_DEV_ROLE'] ?? Env::get('MAR_DEV_ROLE', 'BRAND_ADMIN'));
            $shops  = array_filter(explode(',', (string) ($server['HTTP_X_DEV_SHOPS'] ?? Env::get('MAR_DEV_SHOPS', ''))));

            if ($userId > 0) {
                AuthContext::set($userId, $role, null, array_map('intval', $shops));
                return self::$source = 'dev';
            }
        }

        return null;
    }

    /** La source retenue pour la requête en cours. */
    public static function source(): ?string
    {
        return self::$source;
    }

    /** Le libellé de la personne connectée par l'ERP (lu dans son cookie). */
    public static function label(array $cookies): ?string
    {
        if (self::$source !== 'erp') {
            return null;
        }
        $identity = Session::open((string) ($cookies[Session::COOKIE] ?? ''));

        return $identity['label'] ?? null;
    }
}
