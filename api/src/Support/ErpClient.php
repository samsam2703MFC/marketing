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
 * Le jeton : MAR_ERP_API_TOKEN s'il est posé ; sinon une connexion au réalm
 * admin (POST /api/v1/admin/auth/login) avec MAR_ERP_API_PHONE et
 * MAR_ERP_API_PASSWORD. Un jeton de l'ERP expire en une demi-heure : collé en
 * configuration, il finit refusé, alors que la connexion le renouvelle — une
 * fois par requête, et une seconde sur un 401.
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
     * La connexion y passe aussi, en POST : la méthode et le corps arrivent en
     * quatrième et cinquième arguments, qu'un transport de test peut ignorer.
     *
     * @var null|callable(string, list<string>, int, string=, ?string=): array{0:int, 1:string}
     */
    private $transport;

    /** Jeton obtenu par connexion, gardé le temps de la requête PHP. */
    private static ?string $sessionToken = null;

    /** @param null|callable(string, list<string>, int, string=, ?string=): array{0:int, 1:string} $transport */
    public function __construct(?callable $transport = null)
    {
        $this->transport = $transport;
    }

    /** Vrai si le jeton vient d'une connexion (téléphone + mot de passe) et non de la configuration. */
    private static function usesLogin(): bool
    {
        $fixed = Env::get('MAR_ERP_API_TOKEN');

        return ($fixed === null || $fixed === '')
            && trim((string) Env::get('MAR_ERP_API_PHONE', '')) !== ''
            && (string) Env::get('MAR_ERP_API_PASSWORD', '') !== '';
    }

    /** Oublie le jeton de connexion (tests, ou changement de compte). */
    public static function forgetSession(): void
    {
        self::$sessionToken = null;
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
     * L'adresse où se vérifient les identifiants des personnes : `MAR_ERP_AUTH_BASE`,
     * sinon celle des lectures. Séparée parce que la connexion n'a besoin d'aucun
     * compte de service, alors que les lectures (tarifs, promotions) en demandent un :
     * renseigner l'une ne doit pas lancer les autres sans leurs identifiants.
     */
    public static function authBase(): string
    {
        $auth = rtrim(trim((string) Env::get('MAR_ERP_AUTH_BASE', '')), '/');

        return $auth !== '' ? $auth : self::base();
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

        // Jeton de connexion périmé : une nouvelle connexion, une seule.
        if ($status === 401 && self::usesLogin()) {
            self::$sessionToken = null;
            [$status, $body] = $this->send($url);
        }

        if ($status === 401 || $status === 403) {
            // L'ERP dit souvent quel droit manque (« lacks MENU.BUNDLE.MANAGE ») : on le reprend.
            $raison = json_decode($body, true);
            $raison = is_array($raison) ? ($raison['description'] ?? $raison['message'] ?? null) : null;

            throw new RuntimeException(sprintf(
                'L\'ERP refuse l\'appel (HTTP %d) : vérifiez MAR_ERP_API_TOKEN (ou MAR_ERP_API_PHONE et MAR_ERP_API_PASSWORD) et ses droits%s.',
                $status,
                is_string($raison) && $raison !== '' ? ' — ' . mb_substr($raison, 0, 160) : ''
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
     * Connexion d'une personne à l'ERP, pour ouvrir sa session dans ce module :
     * le réalm `admin`, celui des comptes du réseau. Le jeton rendu n'est pas
     * gardé. Le statut est rendu tel quel — c'est l'appelant qui sait ce qu'un
     * 403 veut dire pour lui.
     *
     * @return array{status:int, token:?string, body:array<mixed>}
     */
    public function authenticate(string $phone, string $password): array
    {
        [$status, $body] = $this->transmit(
            self::authBase() . '/api/v1/admin/auth/login',
            ['Accept: application/json', 'Content-Type: application/json', 'X-Request-Id: ' . self::requestId()],
            'POST',
            (string) json_encode(['phone' => $phone, 'password' => $password])
        );

        $decoded = json_decode($body, true);
        $decoded = is_array($decoded) ? $decoded : [];
        $data    = is_array($decoded['data'] ?? null) ? $decoded['data'] : [];
        $token   = null;
        foreach ([$decoded['access_token'] ?? null, $data['access_token'] ?? null, $decoded['token'] ?? null, $data['token'] ?? null] as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                $token = $candidate;
                break;
            }
        }

        return ['status' => $status, 'token' => $status === 200 ? $token : null, 'body' => $decoded];
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
        $token = $this->token();

        $headers = [
            'Accept: application/json',
            // Repris tel quel par l'ERP dans ses journaux : c'est ce qui permet
            // de retrouver l'appel des deux côtés quand quelque chose cloche.
            'X-Request-Id: ' . self::requestId(),
        ];

        if ($token !== null && $token !== '') {
            $headers[] = 'Authorization: Bearer ' . $token;
        }

        return $this->transmit($url, $headers);
    }

    /**
     * Le jeton à présenter : celui de la configuration, sinon celui d'une
     * connexion au réalm admin. Null : aucun des deux n'est configuré.
     */
    private function token(): ?string
    {
        $fixed = Env::get('MAR_ERP_API_TOKEN');
        if ($fixed !== null && $fixed !== '') {
            return $fixed;
        }

        if (!self::usesLogin()) {
            return null;
        }

        if (self::$sessionToken !== null) {
            return self::$sessionToken;
        }

        [$status, $body] = $this->transmit(
            self::base() . '/api/v1/admin/auth/login',
            ['Accept: application/json', 'Content-Type: application/json', 'X-Request-Id: ' . self::requestId()],
            'POST',
            (string) json_encode([
                'phone'    => trim((string) Env::get('MAR_ERP_API_PHONE', '')),
                'password' => (string) Env::get('MAR_ERP_API_PASSWORD', ''),
            ])
        );

        // La forme du jeton varie selon les versions de l'ERP : la première clé présente.
        $decoded = json_decode($body, true);
        $decoded = is_array($decoded) ? $decoded : [];
        $data    = is_array($decoded['data'] ?? null) ? $decoded['data'] : [];

        foreach ([$decoded['access_token'] ?? null, $decoded['token'] ?? null, $data['access_token'] ?? null, $data['token'] ?? null] as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                return self::$sessionToken = $candidate;
            }
        }

        throw new RuntimeException(sprintf(
            'Connexion à l\'ERP refusée (HTTP %d) : vérifiez MAR_ERP_API_PHONE et MAR_ERP_API_PASSWORD.',
            $status
        ));
    }

    /**
     * Un appel HTTP nu.
     *
     * @param  list<string> $headers
     * @return array{0:int, 1:string}
     */
    private function transmit(string $url, array $headers, string $method = 'GET', ?string $payload = null): array
    {
        $timeout = max(1, (int) (Env::get('MAR_ERP_API_TIMEOUT', '5') ?? '5'));

        if ($this->transport !== null) {
            return ($this->transport)($url, $headers, $timeout, $method, $payload);
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
            if ($method !== 'GET') {
                curl_setopt($handle, CURLOPT_CUSTOMREQUEST, $method);
                curl_setopt($handle, CURLOPT_POSTFIELDS, $payload ?? '');
            }

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
            'method'        => $method,
            'header'        => implode("\r\n", $headers),
            'content'       => $payload ?? '',
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
