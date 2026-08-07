<?php

declare(strict_types=1);

/**
 * Applique les migrations et les seeds une seule fois chacun.
 *
 * Rejouer `db/migrations/*.sql` en bloc à chaque déploiement échoue dès la
 * seconde mise en ligne : les CREATE TABLE se heurtent aux tables existantes.
 * Ce script tient donc un registre — `mar_schema_migration`, préfixé comme le
 * reste du module — et n'applique que ce qui manque.
 *
 * Exception : les fichiers de vues sont rejoués systématiquement. Ils sont
 * écrits en CREATE OR REPLACE, donc idempotents, et c'est le seul moyen qu'une
 * vue modifiée soit réellement mise à jour.
 *
 * Usage :
 *   php db/migrate.php [--dry-run]
 *
 * Connexion : MAR_DB_HOST/PORT ou MAR_DB_SOCKET, puis MAR_DB_NAME/USER/PASSWORD.
 */

require __DIR__ . '/../api/src/autoload.php';

use Marketing\Support\Database;

$dryRun = in_array('--dry-run', $argv, true);
$root   = dirname(__DIR__);
$pdo    = Database::fromEnv();

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS mar_schema_migration (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename    VARCHAR(190)    NOT NULL,
        checksum    CHAR(64)        NOT NULL,
        applied_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_mar_schema_migration (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

/** @var array<string,string> $applied filename => checksum */
$applied = $pdo->query('SELECT filename, checksum FROM mar_schema_migration')
    ->fetchAll(PDO::FETCH_KEY_PAIR);

$files = [];
foreach (['migrations', 'seeds'] as $directory) {
    $found = glob($root . '/db/' . $directory . '/*.sql') ?: [];
    sort($found);
    $files = array_merge($files, $found);
}

$appliedNow = 0;
$skipped    = 0;
$warnings   = 0;

foreach ($files as $path) {
    $name     = basename(dirname($path)) . '/' . basename($path);
    $sql      = file_get_contents($path);
    $checksum = hash('sha256', (string) $sql);

    // Les vues sont idempotentes et doivent suivre les modifications du fichier.
    $isView = str_contains(basename($path), '_vues');

    if (isset($applied[$name]) && !$isView) {
        if ($applied[$name] !== $checksum) {
            // Modifier un fichier déjà appliqué ne le rejoue pas : le changement
            // n'est donc jamais parti en base. Mieux vaut le dire fort.
            fprintf(STDERR, "  ! %s a changé depuis son application — écrire une nouvelle migration\n", $name);
            $warnings++;
        }
        $skipped++;
        continue;
    }

    printf("  → %s%s\n", $name, $dryRun ? ' (simulation)' : '');

    if ($dryRun) {
        $appliedNow++;
        continue;
    }

    $pdo->exec((string) $sql);

    $statement = $pdo->prepare(
        'INSERT INTO mar_schema_migration (filename, checksum) VALUES (:filename, :checksum)
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), applied_at = CURRENT_TIMESTAMP'
    );
    $statement->execute(['filename' => $name, 'checksum' => $checksum]);

    $appliedNow++;
}

printf("\n%d appliqué(s), %d déjà en base, %d avertissement(s)\n", $appliedNow, $skipped, $warnings);

exit($warnings > 0 ? 1 : 0);
