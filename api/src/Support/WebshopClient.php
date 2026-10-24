<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;

/**
 * Le seul point d'appel de l'API du webshop.
 *
 * Les bons d'une campagne vivent dans le moteur de bons du webshop : c'est lui
 * qui les applique au panier, et lui seul les écrit (le module n'écrit jamais
 * les tables de l'ERP). Le module les crée, les suspend et relit leurs
 * commandes par ses routes `/franchisor/*`, avec le jeton du back-office du
 * webshop — un appel de serveur à serveur, jamais depuis le navigateur.
 *
 * Même patron que ErpClient : adresse et jeton lus en configuration, délai,
 * identifiant de requête, échec traduit en message lisible. La différence : le
 * webshop répond 409 / 404 / 400 avec un motif que l'appelant doit pouvoir
 * relayer ; ces statuts lui sont rendus au lieu d'être levés.
 */
final class WebshopClient
{
    /**
     * Transport, injectable pour les tests.
     *
     * @var null|callable(string, string, list<string>, ?string, int): array{0:int, 1:string}
     */
    private $transport;

    /** @param null|callable(string, string, list<string>, ?string, int): array{0:int, 1:string} $transport */
    public function __construct(?callable $transport = null)
    {
        $this->transport = $transport;
    }

    /** Vrai si l'adresse ET le jeton sont renseignés. Sans eux, aucun appel n'est tenté. */
    public function isConfigured(): bool
    {
        if ($this->transport !== null) {
            return true;
        }

        return trim((string) Env::get('MAR_WEBSHOP_API_BASE', '')) !== ''
            && trim((string) Env::get('MAR_WEBSHOP_API_TOKEN', '')) !== '';
    }

    /** Ce qu'il faut dire à l'écran quand rien n'est configuré. */
    public static function missingConfiguration(): string
    {
        return 'La connexion au webshop n\'est pas configurée sur ce serveur '
            . '(MAR_WEBSHOP_API_BASE et MAR_WEBSHOP_API_TOKEN) : les bons ne peuvent être ni lus ni créés.';
    }

    /**
     * Un GET JSON. Lève sur tout échec : une lecture n'a pas de refus métier.
     *
     * @param  array<string, string|int|null> $query
     * @return array<mixed>
     */
    public function get(string $path, array $query = []): array
    {
        [$status, $body] = $this->call('GET', $path, $query, null);

        if ($status >= 400) {
            throw new RuntimeException($this->failure($status, $path, $body));
        }

        return $body;
    }

    /**
     * Un POST JSON. Rend le statut et le corps : 400, 404 et 409 portent un
     * motif métier que l'appelant traduit. Le reste lève.
     *
     * @param  array<string, mixed> $payload
     * @return array{0:int, 1:array<mixed>}
     */
    public function post(string $path, array $payload): array
    {
        [$status, $body] = $this->call('POST', $path, [], json_encode($payload, JSON_UNESCAPED_UNICODE) ?: '{}');

        if ($status >= 400 && !in_array($status, [400, 404, 409], true)) {
            throw new RuntimeException($this->failure($status, $path, $body));
        }

        return [$status, $body];
    }

    /**
     * @param  array<string, string|int|null> $query
     * @return array{0:int, 1:array<mixed>}
     */
    private function call(string $method, string $path, array $query, ?string $payload): array
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException(self::missingConfiguration());
        }

        $filtered = array_filter($query, static fn ($value): bool => $value !== null && $value !== '');
        $url      = rtrim(trim((string) Env::get('MAR_WEBSHOP_API_BASE', '')), '/') . '/' . ltrim($path, '/')
            . ($filtered === [] ? '' : '?' . http_build_query($filtered));
        $timeout  = max(1, (int) (Env::get('MAR_WEBSHOP_API_TIMEOUT', '8') ?? '8'));

        $headers = [
            'Accept: application/json',
            'X-Admin-Token: ' . trim((string) Env::get('MAR_WEBSHOP_API_TOKEN', '')),
            'X-Request-Id: ' . sprintf('mar-%s', bin2hex(random_bytes(8))),
        ];
        if ($payload !== null) {
            $headers[] = 'Content-Type: application/json';
        }

        [$status, $raw] = $this->transport !== null
            ? ($this->transport)($method, $url, $headers, $payload, $timeout)
            : $this->send($method, $url, $headers, $payload, $timeout);

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException(sprintf(
                'Réponse illisible du webshop sur %s (HTTP %d) : attendu du JSON, reçu %s.',
                $path,
                $status,
                $raw === '' ? 'un corps vide' : mb_substr(trim(strip_tags($raw)), 0, 120)
            ));
        }

        return [$status, $decoded];
    }

    /** @param array<mixed> $body */
    private function failure(int $status, string $path, array $body): string
    {
        if ($status === 401 || $status === 403) {
            return 'Le webshop refuse l\'appel : vérifiez MAR_WEBSHOP_API_TOKEN (jeton du back-office du webshop).';
        }

        $motif = is_string($body['error'] ?? null) ? ' : ' . $body['error'] : '.';

        return sprintf('Le webshop a répondu %d sur %s%s', $status, $path, $motif);
    }

    /**
     * @param  list<string> $headers
     * @return array{0:int, 1:string}
     */
    private function send(string $method, string $url, array $headers, ?string $payload, int $timeout): array
    {
        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST  => $method,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => $timeout,
                CURLOPT_CONNECTTIMEOUT => $timeout,
                CURLOPT_HTTPHEADER     => $headers,
            ]);
            if ($payload !== null) {
                curl_setopt($handle, CURLOPT_POSTFIELDS, $payload);
            }

            $body   = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $error  = curl_error($handle);
            curl_close($handle);

            if ($body === false) {
                throw new RuntimeException('Webshop injoignable : ' . ($error === '' ? 'appel impossible' : $error));
            }

            return [$status, (string) $body];
        }

        $context = stream_context_create(['http' => [
            'method'        => $method,
            'header'        => implode("\r\n", $headers),
            'content'       => $payload ?? '',
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ]]);

        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            throw new RuntimeException('Webshop injoignable : appel impossible.');
        }

        $status = 200;
        foreach ($http_response_header ?? [] as $ligne) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $ligne, $trouve) === 1) {
                $status = (int) $trouve[1];
            }
        }

        return [$status, $body];
    }
}
