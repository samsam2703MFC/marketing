<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;

/**
 * Le seul point d'appel de l'API de l'ERP.
 *
 * Le standard interdit qu'un module lise la base d'un autre (§1.1) : ce qui
 * vient de l'ERP vient de son API. Il interdit aussi d'écrire deux fois le même
 * client (§1.3) — d'où cette classe, extraite de l'appel qui existait déjà pour
 * les tarifs, et non un second à côté.
 *
 * Elle porte ce qu'un appelant ne doit pas avoir à refaire : l'adresse de base
 * lue en configuration et jamais en dur, le jeton, l'identifiant de requête que
 * l'ERP renvoie dans ses journaux, le délai, la lecture du JSON, et la
 * traduction d'un échec en message lisible.
 *
 * Ce qu'elle ne fait pas, volontairement : interpréter la charge utile. Les
 * formes de réponse de l'ERP ne sont pas connues de ce dépôt — le swagger
 * documente les chemins, pas les corps — et chaque appelant reste responsable
 * de reconnaître ce qu'il reçoit, en le disant quand il n'y arrive pas.
 */
final class ErpClient
{
    /**
     * Transport, injectable pour les tests.
     *
     * Sa signature est celle d'un appel HTTP nu : URL et en-têtes en entrée,
     * code et corps en sortie. Le remplacer permet d'éprouver la composition
     * d'URL et le traitement des erreurs sans réseau — et sans inventer une
     * réponse de l'ERP, ce que ce dépôt ne fait pas.
     *
     * @var null|callable(string, list<string>, int): array{0:int, 1:string}
     */
    private $transport;

    /** @param null|callable(string, list<string>, int): array{0:int, 1:string} $transport */
    public function __construct(?callable $transport = null)
    {
        $this->transport = $transport;
    }

    /** Vrai si l'adresse de l'ERP est renseignée. Sans elle, aucun appel n'est tenté. */
    public static function isConfigured(): bool
    {
        $base = Env::get('MAR_ERP_API_BASE');

        return $base !== null && trim($base) !== '';
    }

    /** L'adresse de base, sans barre oblique finale. */
    public static function base(): string
    {
        return rtrim(trim((string) Env::get('MAR_ERP_API_BASE', '')), '/');
    }

    /**
     * Ce qu'il faut dire à l'écran quand rien n'est configuré.
     *
     * Un message, pas un silence : « aucune donnée » et « je ne sais pas où
     * regarder » appellent deux gestes différents, et seul le second se corrige
     * en cinq minutes dans un fichier de configuration.
     */
    public static function missingConfiguration(): string
    {
        return 'MAR_ERP_API_BASE n\'est pas renseigné sur ce serveur : le module ne sait pas '
            . 'à quelle adresse joindre l\'ERP, et ne lit plus rien en base pour compenser.';
    }

    /**
     * Un GET JSON.
     *
     * @param  array<string, string|int|null> $query Paramètres, valeurs nulles ignorées.
     * @return array<mixed> Corps décodé.
     */
    public function get(string $path, array $query = []): array
    {
        $url = $this->url($path, $query);

        [$status, $body] = $this->send($url);

        if ($status === 401 || $status === 403) {
            throw new RuntimeException(sprintf(
                'L\'ERP refuse l\'appel (HTTP %d) : vérifiez MAR_ERP_API_TOKEN et ses droits.',
                $status
            ));
        }

        if ($status === 404) {
            throw new RuntimeException(sprintf('Chemin inconnu de l\'ERP : %s.', $path));
        }

        if ($status >= 400) {
            // Le corps peut porter l'explication ; il peut aussi porter une page
            // d'erreur entière. On en garde de quoi comprendre, pas de quoi
            // noyer l'écran.
            throw new RuntimeException(sprintf(
                'L\'ERP a répondu %d sur %s%s',
                $status,
                $path,
                $body === '' ? '.' : ' : ' . mb_substr(trim(strip_tags($body)), 0, 300)
            ));
        }

        $decoded = json_decode($body, true);

        if (!is_array($decoded)) {
            throw new RuntimeException(sprintf(
                'Réponse illisible de l\'ERP sur %s : attendu du JSON, reçu %s.',
                $path,
                $body === '' ? 'un corps vide' : mb_substr(trim(strip_tags($body)), 0, 120)
            ));
        }

        return $decoded;
    }

    /**
     * Le contenu utile d'une réponse, quelle que soit son enveloppe.
     *
     * L'ERP enveloppe tantôt sous `data`, tantôt sous `data.{clé}`, tantôt pas
     * du tout. Le swagger ne tranche pas — il documente les chemins et laisse
     * les corps à « The data ». Plutôt que de supposer, on déballe ce qui se
     * présente, et l'appelant reçoit une liste dans tous les cas.
     *
     * @param  array<mixed> $payload
     * @param  list<string> $keys Clés à essayer sous `data`, dans l'ordre.
     * @return list<array<string,mixed>>
     */
    public static function rows(array $payload, array $keys = []): array
    {
        $niveau = $payload;

        if (isset($niveau['data']) && is_array($niveau['data'])) {
            $niveau = $niveau['data'];
        }

        foreach ($keys as $key) {
            if (isset($niveau[$key]) && is_array($niveau[$key])) {
                $niveau = $niveau[$key];
                break;
            }
        }

        // Une liste d'objets, ou un objet seul qu'on présente comme une liste
        // d'un élément : l'appelant n'a pas à distinguer les deux.
        if ($niveau === []) {
            return [];
        }

        if (array_is_list($niveau)) {
            return array_values(array_filter($niveau, 'is_array'));
        }

        return [$niveau];
    }

    /** @param array<string, string|int|null> $query */
    private function url(string $path, array $query): string
    {
        if (!self::isConfigured()) {
            throw new RuntimeException(self::missingConfiguration());
        }

        $filtered = array_filter(
            $query,
            static fn ($value): bool => $value !== null && $value !== ''
        );

        return self::base() . '/' . ltrim($path, '/')
            . ($filtered === [] ? '' : '?' . http_build_query($filtered));
    }

    /** @return array{0:int, 1:string} */
    private function send(string $url): array
    {
        $timeout = max(1, (int) (Env::get('MAR_ERP_API_TIMEOUT', '5') ?? '5'));
        $token   = Env::get('MAR_ERP_API_TOKEN');

        $headers = [
            'Accept: application/json',
            // Repris tel quel par l'ERP dans ses journaux : c'est ce qui permet
            // de retrouver l'appel des deux côtés quand quelque chose cloche.
            'X-Request-Id: ' . self::requestId(),
        ];

        if ($token !== null && $token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }

        if ($this->transport !== null) {
            return ($this->transport)($url, $headers, $timeout);
        }

        // cURL s'il est chargé, flux HTTP sinon : les deux existent sur la
        // plupart des installations, aucun des deux n'est garanti.
        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            curl_setopt_array($handle, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => $timeout,
                CURLOPT_CONNECTTIMEOUT => $timeout,
                CURLOPT_HTTPHEADER     => $headers,
            ]);

            $body   = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            $error  = curl_error($handle);
            curl_close($handle);

            if ($body === false) {
                throw new RuntimeException(sprintf(
                    'ERP injoignable : %s',
                    $error === '' ? 'appel impossible' : $error
                ));
            }

            return [$status, (string) $body];
        }

        $context = stream_context_create(['http' => [
            'method'        => 'GET',
            'header'        => implode("\r\n", $headers),
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ]]);

        $body = @file_get_contents($url, false, $context);

        if ($body === false) {
            throw new RuntimeException('ERP injoignable : appel impossible.');
        }

        $status = 200;
        foreach ($http_response_header ?? [] as $ligne) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $ligne, $trouve) === 1) {
                $status = (int) $trouve[1];
            }
        }

        return [$status, $body];
    }

    /** Identifiant de requête, repris de l'appelant s'il en a posé un. */
    private static function requestId(): string
    {
        $entrant = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';

        if (is_string($entrant) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $entrant) === 1) {
            return $entrant;
        }

        return sprintf('mar-%s', bin2hex(random_bytes(8)));
    }
}
