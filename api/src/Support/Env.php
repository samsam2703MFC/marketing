<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Chargement des variables d'environnement depuis un fichier `.env`.
 *
 * Pourquoi un fichier plutôt que l'environnement du shell : ni l'un ni l'autre
 * des deux consommateurs ne voit les variables exportées dans un `~/.bashrc`.
 *   • `ssh user@host "php db/migrate.php"` ouvre une session non interactive,
 *     qui ne charge pas les fichiers de profil ;
 *   • l'API tourne sous PHP-FPM ou mod_php, dont l'environnement vient de la
 *     configuration du pool, pas du compte SSH.
 *
 * Le fichier vit à la racine du déploiement, donc **au-dessus** de la racine web
 * (`api/public`) : il n'est pas servi par le serveur web. S'il devait finir dans
 * un répertoire exposé, il faudrait l'interdire explicitement côté vhost.
 *
 * Les variables déjà présentes dans l'environnement réel ne sont jamais
 * écrasées : la configuration du pool ou du conteneur reste prioritaire.
 */
final class Env
{
    private static bool $loaded = false;

    /** Charge le fichier une seule fois. Son absence n'est pas une erreur. */
    public static function load(?string $path = null): void
    {
        if (self::$loaded) {
            return;
        }

        self::$loaded = true;
        $path ??= dirname(__DIR__, 3) . '/.env';

        if (!is_readable($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];

        foreach ($lines as $line) {
            $line = trim($line);

            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            $position = strpos($line, '=');
            if ($position === false) {
                continue;
            }

            $key   = trim(substr($line, 0, $position));
            $value = trim(substr($line, $position + 1));

            $value = self::unquote($value);

            if ($key === '' || getenv($key) !== false) {
                continue;
            }

            putenv(sprintf('%s=%s', $key, $value));
            $_ENV[$key] = $value;
        }
    }

    /**
     * Retire une paire de guillemets encadrants et déséchappe le contenu.
     *
     * La valeur brute a déjà été rognée, ce qui est le comportement attendu pour
     * un fichier écrit à la main — on ne veut pas d'un mot de passe cassé par une
     * espace oubliée en fin de ligne. Une valeur qui doit *réellement* contenir
     * des espaces en bordure, ou qui est elle-même entourée de guillemets, se
     * protège en étant écrite entre guillemets : c'est ce que fait le
     * déploiement, et sans cela ces deux cas seraient tronqués en silence.
     */
    private static function unquote(string $value): string
    {
        if (strlen($value) < 2) {
            return $value;
        }

        $quote = $value[0];

        if (($quote !== '"' && $quote !== "'") || !str_ends_with($value, $quote)) {
            return $value;
        }

        $inner = substr($value, 1, -1);

        // Les guillemets simples sont littéraux, comme dans un shell.
        if ($quote === "'") {
            return $inner;
        }

        return str_replace(['\\"', '\\\\'], ['"', '\\'], $inner);
    }
}
