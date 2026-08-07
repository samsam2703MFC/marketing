<?php

declare(strict_types=1);

namespace Marketing\Support;

use PDOException;
use RuntimeException;
use Throwable;

/**
 * Table de routage du module.
 *
 * Volontairement minimale : dans l'ERP, ces routes doivent être déclarées par le
 * routeur de l'application hôte, et seuls les contrôleurs sont repris. Ce
 * routeur sert aux exécutions autonomes et aux tests.
 */
final class Router
{
    /** @var list<array{method:string, pattern:string, handler:callable, public:bool}> */
    private array $routes = [];

    /** Les segments `{nom}` deviennent des paramètres nommés. */
    public function add(string $method, string $pattern, callable $handler, bool $public = false): void
    {
        $this->routes[] = [
            'method'  => strtoupper($method),
            'pattern' => $pattern,
            'handler' => $handler,
            'public'  => $public,
        ];
    }

    public function get(string $pattern, callable $handler, bool $public = false): void
    {
        $this->add('GET', $pattern, $handler, $public);
    }

    public function post(string $pattern, callable $handler): void
    {
        $this->add('POST', $pattern, $handler);
    }

    public function patch(string $pattern, callable $handler): void
    {
        $this->add('PATCH', $pattern, $handler);
    }

    public function delete(string $pattern, callable $handler): void
    {
        $this->add('DELETE', $pattern, $handler);
    }

    public function dispatch(Request $request): array
    {
        $pathMatched = false;

        foreach ($this->routes as $route) {
            $params = $this->match($route['pattern'], $request->path);
            if ($params === null) {
                continue;
            }

            $pathMatched = true;
            if ($route['method'] !== $request->method) {
                continue;
            }

            if (!$route['public'] && AuthContext::current() === null) {
                return Response::unauthorized();
            }

            try {
                return ($route['handler'])($request->withParams($params));
            } catch (PDOException $e) {
                // PDOException hérite de RuntimeException : sans ce cas en premier,
                // elle passerait pour une erreur métier et son message — qui cite
                // les tables et les colonnes — partirait au client.
                error_log(sprintf('[marketing] SQL: %s', $e->getMessage()));

                return Response::error('Erreur interne du module marketing.', 500);
            } catch (RuntimeException $e) {
                // Erreurs métier levées volontairement par les dépôts.
                return Response::error($e->getMessage(), 422);
            } catch (Throwable $e) {
                // Le détail part dans les logs, pas dans la réponse : un message
                // d'erreur SQL renseigne un attaquant sur le schéma.
                error_log(sprintf('[marketing] %s: %s', $e::class, $e->getMessage()));

                return Response::error('Erreur interne du module marketing.', 500);
            }
        }

        return $pathMatched
            ? Response::error('Méthode non autorisée.', 405)
            : Response::notFound('Route inconnue.');
    }

    /** @return array<string,string>|null */
    private function match(string $pattern, string $path): ?array
    {
        $regex = '#^' . preg_replace('#\{([a-zA-Z_]+)\}#', '(?P<$1>[^/]+)', $pattern) . '/?$#';

        if (preg_match($regex, $path, $matches) !== 1) {
            return null;
        }

        return array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
    }
}
