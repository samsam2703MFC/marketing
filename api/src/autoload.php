<?php

declare(strict_types=1);

/**
 * Autoloader PSR-4 minimal pour le namespace `Marketing\`.
 *
 * L'ERP dispose de Composer : ce fichier n'y sert pas, il suffit d'ajouter
 *   "Marketing\\": "path/to/api/src/"
 * à la section autoload du composer.json. Il n'existe que pour exécuter le
 * module sans dépendance.
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'Marketing\\';

    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file     = __DIR__ . '/' . $relative . '.php';

    if (is_file($file)) {
        require $file;
    }
});
