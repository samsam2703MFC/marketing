<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * Les assistants des catalogues (migration 050) — seul endroit avec du SQL pour :
 *  - les versions publiées de la charte (`mar_catalogue_charter_version`) ;
 *  - ce qu'une boutique fait d'un catalogue (`mar_catalogue_shop`) : réception d'un catalogue de la marque,
 *    points de vérification vus, impression ;
 *  - les liens permanents du catalogue en ligne (`mar_catalogue_link`).
 *
 * Le périmètre d'une boutique est appliqué ici : les catalogues de la marque qu'elle reçoit sont ceux dont les
 * boutiques des versions (`settings.shopIds`) la contiennent, et seulement prêts ou imprimés — un brouillon de la
 * marque n'arrive pas dans les dashboards.
 */
final class CatalogueShopRepository
{
    // ---------------------------------------------------------------------------------------------
    // Versions de la charte
    // ---------------------------------------------------------------------------------------------

    /** @return array{version:int, content:string, note:?string, publishedAt:string, publishedBy:?int}|null La version demandée, ou la dernière. */
    public function charterVersion(?int $version = null): ?array
    {
        $sql = 'SELECT version_no, content, note, published_at, published_by FROM mar_catalogue_charter_version';
        $bind = [];
        if ($version !== null) {
            $sql .= ' WHERE version_no = :v';
            $bind['v'] = $version;
        }
        $statement = Database::connection()->prepare($sql . ' ORDER BY version_no DESC LIMIT 1');
        $statement->execute($bind);
        $row = $statement->fetch();

        return $row === false ? null : self::version($row);
    }

    /** @return array{items: list<array<string,mixed>>, total:int} Les versions, la plus récente d'abord. */
    public function charterVersions(int $page, int $perPage): array
    {
        $total = (int) Database::connection()->query('SELECT COUNT(*) FROM mar_catalogue_charter_version')->fetchColumn();
        $statement = Database::connection()->query(sprintf(
            'SELECT version_no, content, note, published_at, published_by FROM mar_catalogue_charter_version ORDER BY version_no DESC LIMIT %d OFFSET %d',
            $perPage,
            ($page - 1) * $perPage
        ));

        return ['items' => array_map([self::class, 'version'], $statement->fetchAll()), 'total' => $total];
    }

    public function insertCharterVersion(string $content, ?string $note, ?int $userId): int
    {
        $pdo = Database::connection();
        $next = (int) $pdo->query('SELECT COALESCE(MAX(version_no), 0) + 1 FROM mar_catalogue_charter_version')->fetchColumn();
        $statement = $pdo->prepare('INSERT INTO mar_catalogue_charter_version (version_no, content, note, published_by) VALUES (:v, :c, :n, :u)');
        $statement->execute(['v' => $next, 'c' => $content, 'n' => $note, 'u' => $userId]);

        return $next;
    }

    /** Catalogues que la publication touche : pas encore marqués imprimés ; et ceux qui gardent leur version. */
    public function cataloguesCount(): array
    {
        $row = Database::connection()->query("SELECT SUM(status <> 'imprime') AS open_count, SUM(status = 'imprime') AS printed FROM mar_catalogue")->fetch();

        return ['affected' => (int) ($row['open_count'] ?? 0), 'printed' => (int) ($row['printed'] ?? 0)];
    }

    public function freezeCatalogue(int $id, ?int $version): void
    {
        Database::connection()->prepare('UPDATE mar_catalogue SET charter_version = :v WHERE id = :id')->execute(['v' => $version, 'id' => $id]);
    }

    // ---------------------------------------------------------------------------------------------
    // Ce qu'une boutique fait d'un catalogue
    // ---------------------------------------------------------------------------------------------

    /** @return array<string,mixed>|null */
    public function state(int $catalogueId, int $shopId): ?array
    {
        $statement = Database::connection()->prepare('SELECT * FROM mar_catalogue_shop WHERE catalogue_id = :c AND shop_id = :s');
        $statement->execute(['c' => $catalogueId, 's' => $shopId]);
        $row = $statement->fetch();

        return $row === false ? null : self::stateRow($row);
    }

    /**
     * Écrit les champs donnés (les autres restent).
     *
     * @param array{reception?:?string, adapted_id?:?int, checks_seen?:list<string>, print_qty?:?int, printed_at?:?string, charter_version?:?int} $fields
     */
    public function putState(int $catalogueId, int $shopId, array $fields): void
    {
        $current = $this->state($catalogueId, $shopId);
        $row = [
            'reception'       => $current['reception'] ?? null,
            'adapted_id'      => $current['adaptedId'] ?? null,
            'checks_seen'     => $current['checksSeen'] ?? [],
            'print_qty'       => $current['printQty'] ?? null,
            'printed_at'      => $current['printedAt'] ?? null,
            'charter_version' => $current['charterVersion'] ?? null,
        ];
        $row = array_replace($row, $fields);
        $statement = Database::connection()->prepare(
            'INSERT INTO mar_catalogue_shop (catalogue_id, shop_id, reception, adapted_id, checks_seen, print_qty, printed_at, charter_version)
             VALUES (:c, :s, :reception, :adapted, :seen, :qty, :printed, :charter)
             ON DUPLICATE KEY UPDATE reception = VALUES(reception), adapted_id = VALUES(adapted_id), checks_seen = VALUES(checks_seen),
               print_qty = VALUES(print_qty), printed_at = VALUES(printed_at), charter_version = VALUES(charter_version)'
        );
        $statement->execute([
            'c'         => $catalogueId,
            's'         => $shopId,
            'reception' => $row['reception'],
            'adapted'   => $row['adapted_id'],
            'seen'      => json_encode(array_values($row['checks_seen'])),
            'qty'       => $row['print_qty'],
            'printed'   => $row['printed_at'],
            'charter'   => $row['charter_version'],
        ]);
    }

    /**
     * Les catalogues de la marque préparés pour une boutique (elle est dans leurs boutiques des versions), prêts ou
     * imprimés, avec ce qu'elle en a fait.
     *
     * @return array{items: list<array<string,mixed>>, total:int}
     */
    public function received(int $shopId, int $page, int $perPage, ?int $id = null): array
    {
        // Les catalogues seulement (21/11/2026) : un leaflet ou un dépliant de la marque ne va pas au dashboard franchisé, qui
        // ne sait imprimer que des catalogues.
        $where = "c.owner = 'marque' AND c.status IN ('pret', 'imprime') AND JSON_CONTAINS(JSON_EXTRACT(c.settings, '$.shopIds'), :shop)"
            . " AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.settings, '$.support')), 'catalogue') = 'catalogue'";
        $bind = ['shop' => (string) $shopId, 'shop2' => $shopId];
        if ($id !== null) {
            $where .= ' AND c.id = :id';
            $bind['id'] = $id;
        }
        $count = Database::connection()->prepare('SELECT COUNT(*) FROM mar_catalogue c WHERE ' . str_replace(':shop', ':shopc', $where));
        $countBind = ['shopc' => (string) $shopId] + ($id !== null ? ['id' => $id] : []);
        $count->execute($countBind);
        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.id FROM mar_catalogue c LEFT JOIN mar_catalogue_shop cs ON cs.catalogue_id = c.id AND cs.shop_id = :shop2
              WHERE %s ORDER BY (cs.reception IS NULL OR cs.reception = \'nouveau\') DESC, c.updated_at DESC, c.id DESC LIMIT %d OFFSET %d',
            $where,
            $perPage,
            ($page - 1) * $perPage
        ));
        $statement->execute($bind);

        return ['items' => array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN)), 'total' => (int) $count->fetchColumn()];
    }

    // ---------------------------------------------------------------------------------------------
    // Liens permanents
    // ---------------------------------------------------------------------------------------------

    /** @return array{id:int, catalogueId:int, shopId:?int, nonce:string, createdAt:string, revokedAt:?string}|null */
    public function link(int $id): ?array
    {
        $statement = Database::connection()->prepare('SELECT * FROM mar_catalogue_link WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        return $row === false ? null : self::linkRow($row);
    }

    /** @return array<string,mixed>|null Le lien en cours d'un catalogue (et de la boutique de sa version). */
    public function currentLink(int $catalogueId, ?int $shopId): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT * FROM mar_catalogue_link WHERE catalogue_id = :c AND ' . ($shopId === null ? 'shop_id IS NULL' : 'shop_id = :s')
            . ' AND revoked_at IS NULL ORDER BY id DESC LIMIT 1'
        );
        $statement->execute($shopId === null ? ['c' => $catalogueId] : ['c' => $catalogueId, 's' => $shopId]);
        $row = $statement->fetch();

        return $row === false ? null : self::linkRow($row);
    }

    /** Révoque le lien en cours et en crée un autre. @return int L'identifiant du nouveau lien. */
    public function renewLink(int $catalogueId, ?int $shopId, string $nonce): int
    {
        $pdo = Database::connection();
        $revoke = $pdo->prepare('UPDATE mar_catalogue_link SET revoked_at = NOW() WHERE catalogue_id = :c AND '
            . ($shopId === null ? 'shop_id IS NULL' : 'shop_id = :s') . ' AND revoked_at IS NULL');
        $revoke->execute($shopId === null ? ['c' => $catalogueId] : ['c' => $catalogueId, 's' => $shopId]);
        $pdo->prepare('INSERT INTO mar_catalogue_link (catalogue_id, shop_id, nonce) VALUES (:c, :s, :n)')
            ->execute(['c' => $catalogueId, 's' => $shopId, 'n' => $nonce]);

        return (int) $pdo->lastInsertId();
    }

    // ---------------------------------------------------------------------------------------------

    private static function version(array $row): array
    {
        return [
            'version'     => (int) $row['version_no'],
            'content'     => (string) $row['content'],
            'note'        => $row['note'] !== null ? (string) $row['note'] : null,
            'publishedAt' => gmdate('Y-m-d\TH:i:s\Z', (int) strtotime((string) $row['published_at'])),
            'publishedBy' => $row['published_by'] !== null ? (int) $row['published_by'] : null,
        ];
    }

    private static function stateRow(array $row): array
    {
        $seen = json_decode((string) ($row['checks_seen'] ?? '[]'), true);

        return [
            'reception'      => $row['reception'] !== null ? (string) $row['reception'] : null,
            'adaptedId'      => $row['adapted_id'] !== null ? (int) $row['adapted_id'] : null,
            'checksSeen'     => is_array($seen) ? array_values(array_filter($seen, 'is_string')) : [],
            'printQty'       => $row['print_qty'] !== null ? (int) $row['print_qty'] : null,
            'printedAt'      => $row['printed_at'] !== null ? (string) $row['printed_at'] : null,
            'charterVersion' => $row['charter_version'] !== null ? (int) $row['charter_version'] : null,
            'createdAt'      => (string) $row['created_at'],
        ];
    }

    private static function linkRow(array $row): array
    {
        return [
            'id'          => (int) $row['id'],
            'catalogueId' => (int) $row['catalogue_id'],
            'shopId'      => $row['shop_id'] !== null ? (int) $row['shop_id'] : null,
            'nonce'       => (string) $row['nonce'],
            'createdAt'   => gmdate('Y-m-d\TH:i:s\Z', (int) strtotime((string) $row['created_at'])),
            'revokedAt'   => $row['revoked_at'] !== null ? (string) $row['revoked_at'] : null,
        ];
    }
}
