<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * La session d'une personne connectée par ses identifiants de l'ERP.
 *
 * Un cookie `HttpOnly` signé (HMAC-SHA256, secret `MAR_SESSION_SECRET`) porte
 * l'identité résolue à la connexion : un compte réseau, et son libellé. Le serveur ne
 * garde rien ; il vérifie la signature et l'échéance à chaque requête. Le
 * périmètre vient donc toujours du serveur — un client qui réécrit le cookie
 * casse la signature, et la requête repart sans identité (fermeture par défaut).
 *
 * Pas de session côté serveur ni de jeton de l'ERP conservé : le module n'en a
 * pas l'usage, et ce qu'on ne garde pas ne fuit pas.
 */
final class Session
{
    public const COOKIE = 'mar_session';

    /** Douze heures : une journée de travail, puis une nouvelle connexion. */
    public const TTL = 43200;

    /** Le secret de signature, s'il est assez long pour en être un. */
    public static function secret(): ?string
    {
        $secret = (string) Env::get('MAR_SESSION_SECRET', '');

        return strlen($secret) >= 32 ? $secret : null;
    }

    /**
     * Le cookie d'une identité.
     *
     * @param array{user_id:int, role:string, shop_ids:list<int>, label:string} $identity
     */
    public static function seal(array $identity, ?int $now = null): string
    {
        $secret = self::secret();
        if ($secret === null) {
            throw new \RuntimeException('MAR_SESSION_SECRET absent ou trop court.');
        }

        $payload = self::encode((string) json_encode([
            'u' => $identity['user_id'],
            'r' => $identity['role'],
            's' => array_values(array_map('intval', $identity['shop_ids'])),
            'l' => $identity['label'],
            'e' => ($now ?? time()) + self::TTL,
        ], JSON_UNESCAPED_UNICODE));

        return $payload . '.' . self::encode(hash_hmac('sha256', $payload, $secret, true));
    }

    /**
     * L'identité d'un cookie, s'il est intact et non échu.
     *
     * @return array{user_id:int, role:string, shop_ids:list<int>, label:string, expires:int}|null
     */
    public static function open(string $value, ?int $now = null): ?array
    {
        $secret = self::secret();
        if ($secret === null || substr_count($value, '.') !== 1) {
            return null;
        }

        [$payload, $signature] = explode('.', $value, 2);
        $expected = self::encode(hash_hmac('sha256', $payload, $secret, true));
        if (!hash_equals($expected, $signature)) {
            return null;
        }

        $data = json_decode(self::decode($payload), true);
        if (!is_array($data) || !is_int($data['e'] ?? null) || $data['e'] < ($now ?? time())) {
            return null;
        }

        // Le module sert au pilotage de la marque : seule une session réseau s'ouvre.
        if (($data['r'] ?? null) !== 'BRAND_ADMIN') {
            return null;
        }

        return [
            'user_id'  => (int) ($data['u'] ?? 0),
            'role'     => 'BRAND_ADMIN',
            'shop_ids' => [],
            'label'    => (string) ($data['l'] ?? ''),
            'expires'  => $data['e'],
        ];
    }

    /** L'en-tête qui pose le cookie ; une valeur vide l'efface. */
    public static function header(string $value, bool $secure): string
    {
        $parts = [
            self::COOKIE . '=' . $value,
            'Path=/',
            'Max-Age=' . ($value === '' ? 0 : self::TTL),
            'HttpOnly',
            'SameSite=Lax',
        ];
        if ($secure) {
            $parts[] = 'Secure';
        }

        return 'Set-Cookie: ' . implode('; ', $parts);
    }

    /** Vrai si la requête est arrivée en HTTPS (directement ou derrière un relais). */
    public static function isHttps(array $server): bool
    {
        return ($server['HTTPS'] ?? '') === 'on' || ($server['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }

    private static function encode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function decode(string $encoded): string
    {
        return (string) base64_decode(strtr($encoded, '-_', '+/'), true);
    }
}
