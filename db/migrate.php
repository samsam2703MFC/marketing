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

/**
 * Garde-fou de version.
 *
 * Le schéma a besoin du type JSON (`mar_crm_segment.rule_json`) et de
 * `DATETIME DEFAULT CURRENT_TIMESTAMP`, apparus respectivement en MySQL 5.7 et
 * 5.6.5. Sur un serveur plus ancien, les migrations échoueraient à mi-parcours
 * en laissant une base à moitié créée : mieux vaut refuser de commencer.
 */
$version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
$isMaria = stripos($version, 'mariadb') !== false;
preg_match('/^(\d+)\.(\d+)/', $version, $m);
$major = (int) ($m[1] ?? 0);
$minor = (int) ($m[2] ?? 0);

$supported = $isMaria
    ? ($major > 10 || ($major === 10 && $minor >= 2))
    : ($major > 5 || ($major === 5 && $minor >= 7));

printf("Serveur : %s\n", $version);

if (!$supported) {
    fprintf(
        STDERR,
        "Version trop ancienne. Requis : MySQL 5.7+ ou MariaDB 10.2+ (type JSON).\n"
        . "Aucune migration n'a été appliquée.\n"
    );
    exit(2);
}

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
