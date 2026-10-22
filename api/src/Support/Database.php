<?php

declare(strict_types=1);

namespace Marketing\Support;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Fabrique de connexion PDO.
 *
 * Dans l'ERP, ce module doit recevoir la connexion existante via `setConnection()`
 * plutôt que d'en ouvrir une seconde — deux pools sur la même base gaspillent des
 * connexions et compliquent les transactions. `fromEnv()` n'existe que pour les
 * exécutions autonomes (tests, scripts de migration).
 */
final class Database
{
    private static ?PDO $connection = null;

    /** Injecte la connexion de l'application hôte. */
    public static function setConnection(PDO $pdo): void
    {
        self::$connection = $pdo;
    }

    public static function connection(): PDO
    {
        if (self::$connection === null) {
            self::$connection = self::fromEnv();
        }

        return self::$connection;
    }

    /**
     * Ouvre une connexion depuis l'environnement. Accepte un socket Unix
     * (MAR_DB_SOCKET) ou un couple hôte/port.
     */
    public static function fromEnv(): PDO
    {
        // Le fichier `.env` de la racine du déploiement complète l'environnement :
        // ni la session SSH non interactive ni le pool PHP-FPM ne voient les
        // variables exportées dans un profil de shell.
        $database = Env::get('MAR_DB_NAME', '') ?: '';
        if ($database === '') {
            throw new RuntimeException(
                'MAR_DB_NAME est requis. Renseignez le fichier .env à la racine du déploiement '
                . '(voir .env.example) ou l\'environnement du processus.'
            );
        }

        $socket = Env::get('MAR_DB_SOCKET', '') ?: '';
        $dsn = $socket !== ''
            ? sprintf('mysql:unix_socket=%s;dbname=%s;charset=utf8mb4', $socket, $database)
            : sprintf(
                'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                Env::get('MAR_DB_HOST', '127.0.0.1'),
                Env::get('MAR_DB_PORT', '3306'),
                $database
            );

        try {
            return new PDO($dsn, Env::get('MAR_DB_USER', 'root'), Env::get('MAR_DB_PASSWORD', ''), [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Les requêtes préparées côté serveur : les valeurs ne sont jamais
                // interpolées dans le SQL, même en cas d'émulation mal configurée.
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            // Le message PDO peut contenir le DSN, donc les identifiants : on ne
            // le laisse pas remonter jusqu'à la réponse HTTP.
            throw new RuntimeException('Connexion à la base marketing impossible.', 0, $e);
        }
    }

    /**
     * Cette colonne existe-t-elle vraiment ?
     *
     * Les tables du module sont posées par `sql/mar-referentiels.sql`, rejoué à
     * la main : une colonne récente manque tant que le rejeu n'a pas eu lieu.
     * Le code qui s'en sert demande donc avant d'écrire, plutôt que de faire
     * échouer TOUTES les écritures d'une table pour une colonne absente — et
     * l'écran dit alors ce qui lui manque au lieu de rendre une erreur nue.
     *
     * Mémorisé le temps de la requête HTTP : information_schema ne bouge pas
     * sous nos pieds pendant un appel.
     *
     * @var array<string,bool>
     */
    private static array $columns = [];

    public static function hasColumn(string $table, string $column): bool
    {
        $key = $table . '.' . $column;
        if (array_key_exists($key, self::$columns)) {
            return self::$columns[$key];
        }

        $statement = self::connection()->prepare(
            'SELECT 1 FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c
              LIMIT 1'
        );
        $statement->execute(['t' => $table, 'c' => $column]);

        return self::$columns[$key] = (bool) $statement->fetchColumn();
    }

    /**
     * Construit une liste de placeholders nommés pour une clause IN.
     * Retourne le fragment SQL et les paramètres à lier.
     *
     * @param  list<int|string> $values
     * @return array{0:string, 1:array<string,int|string>}
     */
    public static function inClause(array $values, string $prefix): array
    {
        $placeholders = [];
        $bindings     = [];

        foreach (array_values($values) as $index => $value) {
            $key                  = sprintf(':%s%d', $prefix, $index);
            $placeholders[]       = $key;
            $bindings[substr($key, 1)] = $value;
        }

        return [implode(', ', $placeholders), $bindings];
    }
}
