<?php

declare(strict_types=1);

/**
 * Reprise des boutiques et des comptes professionnels depuis l'ERP.
 *
 * Même traitement que le bouton de l'écran « Fidélité & CRM », en ligne de
 * commande : c'est ce qui permet de l'enchaîner après les migrations lors d'un
 * déploiement, et de lire le compte rendu dans le journal plutôt que sur un
 * écran auquel on n'a pas forcément accès au moment où l'on en a besoin.
 *
 * Lecture seule côté ERP. Le script n'écrit que dans les tables `mar_`.
 *
 * Exécution :
 *   php db/sync-erp.php                  reprend, puis affiche les boutiques
 *   php db/sync-erp.php --dry-run        n'écrit rien, dit ce qu'il lirait
 *   php db/sync-erp.php --brand="Nom"    crée l'enseigne quand l'ERP ne la
 *                                        porte nulle part de lisible
 *
 * `--brand-b64=` accepte le même nom encodé en base64. C'est ce qu'utilise le
 * déploiement : la valeur traverse deux interpréteurs de commandes — celui du
 * runner puis celui du serveur — et une apostrophe dans « L'Atelier By » y
 * ferme la chaîne. L'encodage supprime la question au lieu d'empiler les
 * échappements.
 */

use Marketing\Repository\ErpSyncRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Env;

require __DIR__ . '/../api/src/autoload.php';

$dryRun = in_array('--dry-run', $argv, true);

// Nom d'enseigne fourni à la main. Dernier recours : une marque est un fait
// commercial, elle se lit dans l'ERP quand il la porte, et ne s'invente pas.
$brandName = '';
foreach ($argv as $argument) {
    if (str_starts_with($argument, '--brand=')) {
        $brandName = trim(substr($argument, 8));
    }

    if (str_starts_with($argument, '--brand-b64=')) {
        $decoded = base64_decode(substr($argument, 12), true);
        if ($decoded === false) {
            fprintf(STDERR, "--brand-b64 : encodage base64 invalide.\n");
            exit(2);
        }

        $brandName = trim($decoded);
    }
}

Env::load();

try {
    $pdo = Database::connection();
} catch (Throwable $failure) {
    fprintf(STDERR, "Connexion impossible : %s\n", $failure->getMessage());
    exit(3);
}

printf("Base : %s\n", (string) $pdo->query('SELECT DATABASE()')->fetchColumn());

// L'identité est celle d'un traitement, pas d'une personne : les lignes créées
// portent `created_by = NULL` plutôt que l'identifiant d'un utilisateur qui
// n'a rien demandé.
AuthContext::set(0, 'BRAND_ADMIN', null);

$repository = new ErpSyncRepository();

// Les marques d'abord : sans elles, rien à quoi rattacher une boutique. Le
// module en avait besoin depuis le début et rien ne les créait — d'où une base
// installée, migrée, et pourtant inutilisable.
if ($brandName !== '') {
    $code = strtolower((string) preg_replace(
        '/[^A-Za-z0-9]+/',
        '-',
        (string) (iconv('UTF-8', 'ASCII//TRANSLIT', $brandName) ?: $brandName)
    ));
    $statement = $pdo->prepare(
        'INSERT INTO mar_brand (code, name) VALUES (:code, :name)
         ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1'
    );
    $statement->execute(['code' => trim($code, '-') ?: 'marque', 'name' => $brandName]);
    printf("Enseigne déclarée : %s\n", $brandName);
} else {
    try {
        $result = $repository->syncBrands(AuthContext::current());
        printf(
            "Marques    source %s — %d lue(s), %d créée(s), %d mise(s) à jour\n",
            $result['source'],
            $result['read'],
            $result['created'],
            $result['updated']
        );
    } catch (Throwable $failure) {
        fprintf(STDERR, "Marques : %s\n", $failure->getMessage());
        exit(4);
    }
}

// Marque de rattachement des boutiques. Une seule active dans le cas courant ;
// au-delà, on s'arrête plutôt que de les rattacher à la mauvaise enseigne.
$brands = $pdo->query('SELECT id, name FROM mar_brand WHERE is_active = 1')->fetchAll();

if (count($brands) !== 1) {
    fprintf(
        STDERR,
        $brands === []
            ? "Aucune marque active : rien à quoi rattacher les boutiques.\n"
            : "Plusieurs marques actives (%s) : les boutiques de l'ERP ne disent pas laquelle. Reprise des boutiques non effectuée.\n",
        implode(', ', array_column($brands, 'name'))
    );
    exit(4);
}

$brandId = (int) $brands[0]['id'];
printf("Marque : %s\n\n", $brands[0]['name']);
AuthContext::set(0, 'BRAND_ADMIN', $brandId);

if ($dryRun) {
    echo "Mode --dry-run : lecture seule, aucune écriture.\n\n";
}

$report = [];

try {
    // La reprise est en deux temps : les comptes se rattachent aux boutiques,
    // donc les boutiques passent d'abord.
    if (!$dryRun) {
        $report = $repository->sync(AuthContext::current(), $brandId);
    }
} catch (Throwable $failure) {
    fprintf(STDERR, "Reprise interrompue : %s\n", $failure->getMessage());
    exit(5);
}

$inventory = $report['inventory'] ?? [];
unset($report['inventory']);

foreach ($report as $label => $result) {
    printf(
        "%-10s source %s — %d lue(s), %d créée(s), %d mise(s) à jour, %d écartée(s)%s\n",
        $label === 'shops' ? 'Boutiques' : 'Comptes',
        $result['source'],
        $result['read'],
        $result['created'],
        $result['updated'],
        $result['skipped'],
        ($result['truncated'] ?? 0) > 0
            ? sprintf(', %d valeur(s) rognée(s)', $result['truncated'])
            : ''
    );
    printf("           colonnes retenues : %s\n", json_encode($result['columns'], JSON_UNESCAPED_UNICODE));

    if (isset($result['warning'])) {
        printf("           ATTENTION : %s\n", $result['warning']);
    }
}

// Vérification : ce que le module voit maintenant. C'est le seul contrôle qui
// compte — un compte rendu de reprise peut être flatteur et la table vide.
$shops = $pdo->query(
    'SELECT id, erp_shop_id, code, name, city FROM mar_shop ORDER BY name'
)->fetchAll();

printf("\nBoutiques dans le module : %d\n", count($shops));
// `printf` compte les octets : « Châtelain » en pèse plus qu'il n'affiche de
// caractères, et un %-28s désaligne toute la colonne suivante.
$pad = static fn (string $text, int $width): string
    => $text . str_repeat(' ', max(0, $width - mb_strlen($text)));

foreach ($shops as $shop) {
    printf(
        "  #%s erp:%s %s %s\n",
        $pad((string) $shop['id'], 4),
        $pad((string) ($shop['erp_shop_id'] ?? '—'), 5),
        $pad((string) $shop['name'], 28),
        $shop['city'] ?? ''
    );
}

$unlinked = count(array_filter($shops, static fn (array $s): bool => $s['erp_shop_id'] === null));
if ($unlinked > 0) {
    printf(
        "\n%d boutique(s) sans identifiant ERP : saisies à la main, elles ne\n"
        . "recevront aucun compte B2B tant qu'elles ne correspondent pas à une\n"
        . "boutique de l'ERP.\n",
        $unlinked
    );
}

// Inventaire des sources : ce que les tables de l'ERP contiennent vraiment.
// C'est ce qui permet de trancher entre « la colonne n'existe pas » et « elle
// porte un nom auquel la liste des candidates n'a pas pensé ».
foreach ($inventory as $table => $detail) {
    printf("\n%s\n", $table);
    printf("  notions non reconnues : %s\n", implode(', ', $detail['non reconnues']) ?: 'aucune');
    printf("  colonnes présentes    : %s\n", implode(', ', $detail['disponibles']));
}

// Tables à inspecter sans les exploiter encore : on demande leur structure
// plutôt que de la supposer, ce qui coûte un seul aller-retour au lieu d'un
// par hypothèse.
foreach (['b2b_client_type'] as $table) {
    $columns = $repository->describe($table);
    printf(
        "\n%s\n  colonnes présentes    : %s\n",
        $table,
        $columns === [] ? 'table absente' : implode(', ', $columns)
    );
}

$prospects = (int) $pdo->query(
    "SELECT COUNT(*) FROM mar_b2b_prospect WHERE source = 'ERP'"
)->fetchColumn();
$attached = (int) $pdo->query(
    "SELECT COUNT(*) FROM mar_b2b_prospect WHERE source = 'ERP' AND shop_id IS NOT NULL"
)->fetchColumn();

printf("\nComptes B2B repris : %d, dont %d rattachés à une boutique\n", $prospects, $attached);

if ($shops === []) {
    fprintf(STDERR, "\nAucune boutique : la reprise n'a rien produit d'exploitable.\n");
    exit(6);
}

exit(0);
