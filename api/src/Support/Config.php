<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;
use Throwable;

/**
 * Les réglages du module (`mar_variable`) : adresses des API, délais, chemins.
 *
 * Ordre de lecture : la table, puis l'environnement (le `.env` d'avant, gardé en
 * repli le temps de la transition), puis la valeur par défaut. Une valeur posée
 * depuis l'écran l'emporte donc sur le fichier.
 *
 * Ne passent jamais par ici (ils restent dans l'environnement, par construction) :
 * l'accès à la base (`MAR_DB_*` — il faut l'avoir pour lire la table), le fichier
 * de la clé maîtresse (`MAR_KEYS_FILE`), le chemin d'installation
 * (`MAR_BASE_PATH`), et l'identité de développement (`MAR_DEV_*`) : une base
 * modifiable ne doit pas pouvoir ouvrir le module à n'importe qui. Les secrets
 * passent par `Keys`.
 */
final class Config
{
    /** Ce qui ne se lit jamais en base. */
    public const BOOTSTRAP = [
        'MAR_DB_HOST', 'MAR_DB_PORT', 'MAR_DB_NAME', 'MAR_DB_USER', 'MAR_DB_PASSWORD', 'MAR_DB_SOCKET',
        'MAR_ENV_FILE', 'MAR_KEYS_FILE', 'MAR_BASE_PATH',
        'MAR_DEV_AUTH', 'MAR_DEV_USER_ID', 'MAR_DEV_ROLE', 'MAR_DEV_SHOPS', 'MAR_ALLOW_DESTRUCTIVE_TESTS',
    ];

    /** @var array<string, array<string, array{value:mixed, description:?string, updated_at:string}>> */
    private static array $rows = [];

    /**
     * Un réglage, en chaîne (comme `Env::get`) : table, puis environnement, puis défaut.
     */
    public static function get(string $name, ?string $default = null, string $module = 'marketing'): ?string
    {
        if (!in_array($name, self::BOOTSTRAP, true)) {
            $row = self::rows($module)[$name] ?? null;
            if ($row !== null && $row['value'] !== null && $row['value'] !== '') {
                $value = $row['value'];

                return is_scalar($value) ? (is_bool($value) ? ($value ? '1' : '0') : (string) $value) : (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
        }

        return $module === 'marketing' ? Env::get($name, $default) : $default;
    }

    /** La valeur telle qu'enregistrée (tableau, nombre…), ou `null`. */
    public static function value(string $name, string $module = 'marketing'): mixed
    {
        return self::rows($module)[$name]['value'] ?? null;
    }

    public static function put(string $name, mixed $value, string $module = 'marketing', ?int $userId = null, ?string $description = null): void
    {
        if (!in_array($module, Keys::MODULES, true) || preg_match('/^[A-Za-z][A-Za-z0-9_.-]{1,79}$/', $name) !== 1) {
            throw new RuntimeException('Nom de réglage invalide.');
        }
        if (in_array($name, self::BOOTSTRAP, true)) {
            throw new RuntimeException($name . ' reste dans la configuration du serveur : il ne se règle pas en base.');
        }

        $statement = Database::connection()->prepare(
            'INSERT INTO mar_variable (module, name, value, description, updated_by)
             VALUES (:module, :name, :value, :description, :user)
             ON DUPLICATE KEY UPDATE value = VALUES(value), description = COALESCE(VALUES(description), description), updated_by = VALUES(updated_by)'
        );
        $statement->execute([
            'module'      => $module,
            'name'        => $name,
            'value'       => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'description' => $description,
            'user'        => $userId,
        ]);
        self::forget();
    }

    public static function delete(string $name, string $module = 'marketing'): bool
    {
        $statement = Database::connection()->prepare('DELETE FROM mar_variable WHERE module = :module AND name = :name');
        $statement->execute(['module' => $module, 'name' => $name]);
        self::forget();

        return $statement->rowCount() > 0;
    }

    /** @return array<string, array{value:mixed, description:?string, updated_at:string}> */
    public static function all(string $module = 'marketing'): array
    {
        return self::rows($module);
    }

    public static function forget(): void
    {
        self::$rows = [];
    }

    /** @return array<string, array{value:mixed, description:?string, updated_at:string}> */
    private static function rows(string $module): array
    {
        if (isset(self::$rows[$module])) {
            return self::$rows[$module];
        }
        $rows = [];
        try {
            $statement = Database::connection()->prepare(
                'SELECT name, value, description, updated_at FROM mar_variable WHERE module = :module ORDER BY name'
            );
            $statement->execute(['module' => $module]);
            foreach ($statement->fetchAll() as $row) {
                $rows[(string) $row['name']] = [
                    'value'       => $row['value'] !== null ? json_decode((string) $row['value'], true) : null,
                    'description' => $row['description'] !== null ? (string) $row['description'] : null,
                    'updated_at'  => (string) $row['updated_at'],
                ];
            }
        } catch (Throwable) {
            // Table absente (avant la migration 040) ou base injoignable : l'environnement prend le relais.
        }

        return self::$rows[$module] = $rows;
    }
}
