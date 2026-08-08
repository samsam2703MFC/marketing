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
$links     = $report['links'] ?? null;
unset($report['inventory'], $report['links']);

$titles = ['shops' => 'Boutiques', 'prospects' => 'Comptes', 'sectors' => 'Secteurs'];

foreach ($report as $label => $result) {
    printf(
        "%-10s source %s — %d lue(s), %d créée(s), %d mise(s) à jour, %d écartée(s)%s\n",
        $titles[$label] ?? $label,
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

    if (($result['retired'] ?? 0) > 0) {
        printf(
            "           %d secteur(s) hors ERP désactivé(s) : la liste vient maintenant de l'ERP\n",
            $result['retired']
        );
    }

    if (isset($result['warning'])) {
        printf("           ATTENTION : %s\n", $result['warning']);
    }
}

// Le rattachement compte des liens, pas des fiches : il a son propre rendu.
// C'est aussi la seule partie qui peut échouer seule, et son message est alors
// la réponse à « pourquoi l'assistant ne propose aucun secteur ».
if (is_array($links)) {
    if (isset($links['error'])) {
        printf("Secteurs   ÉCHEC du rattachement : %s\n", $links['error']);
    } else {
        printf(
            "Liaisons   source %s — %d lue(s), %d rattachée(s), %d hors vivier, %d type inconnu, %d remplacée(s)\n",
            $links['source'],
            $links['read'],
            $links['linked'],
            $links['unknown_client'],
            $links['unknown_sector'],
            $links['removed']
        );
        printf("           colonnes retenues : %s\n", json_encode($links['columns'], JSON_UNESCAPED_UNICODE));

        // La mesure de ce que valent ces colonnes, et non la seule affirmation
        // qu'elles ont été retenues : deux d'entre elles peuvent l'avoir été
        // sur la foi de leur nom.
        if (isset($links['match'])) {
            printf("           correspondance    : %s\n", $links['match']);
        }

        if (($links['without_sector'] ?? 0) > 0) {
            printf(
                "           %d compte(s) du vivier sans aucun secteur : ils ne sortiront d'aucune génération\n",
                $links['without_sector']
            );
        }

        if (isset($links['warning'])) {
            printf("           ATTENTION : %s\n", $links['warning']);
        }
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

// Les sondes exploratoires ont été retirées : chaque table qui sert est
// maintenant lue par du code qui rapporte lui-même les colonnes retenues, et
// qui nomme celles présentes quand il ne s'y retrouve pas. Elles coûtaient
// surtout des annotations — GitHub n'en garde que dix par étape, et les
// dernières émises, justement celles qu'on venait ajouter, disparaissaient.

$prospects = (int) $pdo->query(
    "SELECT COUNT(*) FROM mar_b2b_prospect WHERE source = 'ERP'"
)->fetchColumn();
$attached = (int) $pdo->query(
    "SELECT COUNT(*) FROM mar_b2b_prospect WHERE source = 'ERP' AND shop_id IS NOT NULL"
)->fetchColumn();

printf("\nComptes B2B repris : %d, dont %d rattachés à une boutique\n", $prospects, $attached);

// Ce que l'assistant proposera réellement à l'étape « secteurs visés ». Un
// secteur sans compte s'affiche « · 0 » : il se coche, et ne génère rien.
$sectors = $pdo->query(
    'SELECT s.label,
            (SELECT COUNT(*)
               FROM mar_b2b_prospect_sector ps
               JOIN mar_b2b_prospect p ON p.id = ps.prospect_id AND p.is_active = 1
              WHERE ps.sector_id = s.id) AS comptes
       FROM mar_b2b_sector s
      WHERE s.is_active = 1
      ORDER BY s.sort_order'
)->fetchAll();

$withAccounts = count(array_filter($sectors, static fn (array $s): bool => (int) $s['comptes'] > 0));

printf(
    "Secteurs proposés : %d, dont %d avec au moins un compte\n",
    count($sectors),
    $withAccounts
);

foreach ($sectors as $sector) {
    printf("  %s %s\n", $pad((string) $sector['label'], 34), $sector['comptes']);
}

if ($shops === []) {
    fprintf(STDERR, "\nAucune boutique : la reprise n'a rien produit d'exploitable.\n");
    exit(6);
}

exit(0);
