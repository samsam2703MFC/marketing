<?php

declare(strict_types=1);

namespace Marketing\Support;

/** Accès typé aux paramètres de requête. */
final class Request
{
    /** @param array<string,mixed> $query @param array<string,mixed> $body */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query = [],
        public readonly array $body = [],
        /** @var array<string,string> Segments capturés dans le chemin */
        public readonly array $params = [],
    ) {
    }

    public static function fromGlobals(): self
    {
        $path = self::stripBasePath(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        $raw  = file_get_contents('php://input') ?: '';

        $decoded = $raw === '' ? [] : json_decode($raw, true);

        return new self(
            strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            $path,
            $_GET,
            is_array($decoded) ? $decoded : [],
        );
    }

    /**
     * Retire le préfixe du sous-répertoire d'installation.
     *
     * Les routes sont déclarées en absolu (`/api/v1/marketing/...`), mais
     * l'application est servie sous un chemin — `/marketing` ici. Sans ce
     * nettoyage, `REQUEST_URI` vaut `/marketing/api/v1/...` et aucune route ne
     * correspond : toute l'API répond 404 en production alors qu'elle passe en
     * développement, où elle est servie à la racine.
     *
     * `MAR_BASE_PATH` permet de forcer le préfixe ; à défaut on coupe à la
     * première occurrence de `/api/v1/`, ce qui vaut pour n'importe quel
     * répertoire d'installation.
     */
    private static function stripBasePath(string $path): string
    {
        $base = getenv('MAR_BASE_PATH');
        if (is_string($base) && $base !== '') {
            $base = '/' . trim($base, '/');
            if ($base !== '/' && str_starts_with($path, $base)) {
                $path = substr($path, strlen($base));

                return $path === '' ? '/' : $path;
            }
        }

        $position = strpos($path, '/api/v1/');

        return $position !== false && $position > 0 ? substr($path, $position) : $path;
    }

    public function withParams(array $params): self
    {
        return new self($this->method, $this->path, $this->query, $this->body, $params);
    }

    public function param(string $key): ?string
    {
        return $this->params[$key] ?? null;
    }

    public function intParam(string $key): ?int
    {
        $value = $this->param($key);

        return $value !== null && ctype_digit($value) ? (int) $value : null;
    }

    public function queryString(string $key, ?string $default = null): ?string
    {
        $value = $this->query[$key] ?? null;

        return is_string($value) && $value !== '' ? $value : $default;
    }

    public function queryInt(string $key, ?int $default = null): ?int
    {
        $value = $this->query[$key] ?? null;

        return is_numeric($value) ? (int) $value : $default;
    }

    /** Valeur de liste déroulante contrainte : hors liste, on retombe sur le défaut. */
    public function queryEnum(string $key, array $allowed, string $default): string
    {
        $value = $this->queryString($key);

        return $value !== null && in_array($value, $allowed, true) ? $value : $default;
    }

    /** @return mixed */
    public function input(string $key, $default = null)
    {
        return $this->body[$key] ?? $default;
    }

    /**
     * Ne garde du corps que les clés attendues, pour qu'un client ne puisse pas
     * écrire une colonne non prévue par l'endpoint.
     *
     * @param  list<string> $allowed
     * @return array<string,mixed>
     */
    public function only(array $allowed): array
    {
        return array_intersect_key($this->body, array_flip($allowed));
    }

    /**
     * Champs obligatoires manquants ou vides.
     *
     * @param  list<string> $required
     * @return list<string>
     */
    public function missing(array $required): array
    {
        $missing = [];
        foreach ($required as $field) {
            $value = $this->body[$field] ?? null;
            if ($value === null || $value === '') {
                $missing[] = $field;
            }
        }

        return $missing;
    }
}
