<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * Les catalogues (`mar_catalogue`) — seul endroit avec du SQL pour eux.
 *
 * Le périmètre est appliqué ici : `$shopId` non nul limite toute lecture et toute écriture aux
 * catalogues de cette boutique (`owner = boutique AND shop_id = :shop`) ; une boutique ne
 * lit, ne modifie ni ne supprime jamais le catalogue d'une autre, ni ceux de la marque.
 */
final class CatalogueRepository
{
    /** Tris acceptés : champ public → colonne. */
    public const SORTS = ['updatedAt' => 'c.updated_at', 'createdAt' => 'c.created_at', 'title' => 'c.title'];

    private const COLUMNS = 'c.id, c.title, c.owner, c.shop_id, c.source_kind, c.source_ref, c.source_label, c.format, c.status,
        c.print_qty, c.charter_version, c.settings, c.created_at, c.updated_at, s.name AS shop_name, s.erp_shop_id AS shop_erp_id';

    /**
     * Une page de catalogues.
     *
     * @param array{owner?:string, status?:string, shop?:int} $filters
     * @return array{items: list<array<string,mixed>>, total: int}
     */
    public function page(array $filters, string $sort, bool $descending, int $page, int $perPage, ?int $shopId = null): array
    {
        $where = ['1 = 1'];
        $bind  = [];
        if ($shopId !== null) {
            $where[] = "c.owner = 'boutique' AND c.shop_id = :scope_shop";
            $bind['scope_shop'] = $shopId;
        }
        if (isset($filters['owner'])) {
            $where[] = 'c.owner = :owner';
            $bind['owner'] = $filters['owner'];
        }
        if (isset($filters['status'])) {
            $where[] = 'c.status = :status';
            $bind['status'] = $filters['status'];
        }
        if (isset($filters['shop'])) {
            $where[] = 'c.shop_id = :shop';
            $bind['shop'] = $filters['shop'];
        }
        $sql = implode(' AND ', $where);

        $count = Database::connection()->prepare('SELECT COUNT(*) FROM mar_catalogue c WHERE ' . $sql);
        $count->execute($bind);

        $order = (self::SORTS[$sort] ?? self::SORTS['updatedAt']) . ($descending ? ' DESC' : ' ASC') . ', c.id DESC';
        $statement = Database::connection()->prepare(sprintf(
            'SELECT %s FROM mar_catalogue c LEFT JOIN mar_shop s ON s.id = c.shop_id WHERE %s ORDER BY %s LIMIT %d OFFSET %d',
            self::COLUMNS,
            $sql,
            $order,
            $perPage,
            ($page - 1) * $perPage
        ));
        $statement->execute($bind);

        return ['items' => array_map([self::class, 'decode'], $statement->fetchAll()), 'total' => (int) $count->fetchColumn()];
    }

    /** Un catalogue ; `null` s'il n'existe pas ou sort du périmètre de la boutique. */
    public function find(int $id, ?int $shopId = null): ?array
    {
        $sql = sprintf('SELECT %s FROM mar_catalogue c LEFT JOIN mar_shop s ON s.id = c.shop_id WHERE c.id = :id', self::COLUMNS);
        $bind = ['id' => $id];
        if ($shopId !== null) {
            $sql .= " AND c.owner = 'boutique' AND c.shop_id = :scope_shop";
            $bind['scope_shop'] = $shopId;
        }
        $statement = Database::connection()->prepare($sql);
        $statement->execute($bind);
        $row = $statement->fetch();

        return $row === false ? null : self::decode($row);
    }

    /** @param array<string,mixed> $row Colonnes de `mar_catalogue` (settings en tableau). */
    public function insert(array $row, ?int $userId): int
    {
        $statement = Database::connection()->prepare(
            'INSERT INTO mar_catalogue (title, owner, shop_id, source_kind, source_ref, source_label, format, status, print_qty, settings, created_by, updated_by)
             VALUES (:title, :owner, :shop_id, :source_kind, :source_ref, :source_label, :format, :status, :print_qty, :settings, :user, :user2)'
        );
        $statement->execute([
            'title'        => $row['title'],
            'owner'        => $row['owner'],
            'shop_id'      => $row['shop_id'],
            'source_kind'  => $row['source_kind'],
            'source_ref'   => $row['source_ref'],
            'source_label' => $row['source_label'],
            'format'       => $row['format'],
            'status'       => $row['status'],
            'print_qty'    => $row['print_qty'],
            'settings'     => json_encode($row['settings'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'user'         => $userId,
            'user2'        => $userId,
        ]);

        return (int) Database::connection()->lastInsertId();
    }

    /**
     * Remplace les champs modifiables. Le périmètre de la boutique est dans la condition : un
     * catalogue d'une autre boutique n'est pas touché.
     *
     * @param array<string,mixed> $row
     */
    public function update(int $id, array $row, ?int $userId, ?int $shopId = null): bool
    {
        $sql = 'UPDATE mar_catalogue SET title = :title, format = :format, status = :status, print_qty = :print_qty,
                settings = :settings, updated_by = :user WHERE id = :id';
        $bind = [
            'id'        => $id,
            'title'     => $row['title'],
            'format'    => $row['format'],
            'status'    => $row['status'],
            'print_qty' => $row['print_qty'],
            'settings'  => json_encode($row['settings'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'user'      => $userId,
        ];
        if ($shopId !== null) {
            $sql .= " AND owner = 'boutique' AND shop_id = :scope_shop";
            $bind['scope_shop'] = $shopId;
        }
        $statement = Database::connection()->prepare($sql);
        $statement->execute($bind);

        return $this->find($id, $shopId) !== null;
    }

    public function delete(int $id, ?int $shopId = null): bool
    {
        $sql = 'DELETE FROM mar_catalogue WHERE id = :id';
        $bind = ['id' => $id];
        if ($shopId !== null) {
            $sql .= " AND owner = 'boutique' AND shop_id = :scope_shop";
            $bind['scope_shop'] = $shopId;
        }
        $statement = Database::connection()->prepare($sql);
        $statement->execute($bind);

        return $statement->rowCount() > 0;
    }

    /**
     * Boutiques connues du module, par identifiant (`mar_shop.id`).
     *
     * @param list<int> $ids Vide : toutes celles qui ont un identifiant de caisse.
     * @return list<array{id:int, name:string, erpShopId:?int}>
     */
    public function shops(array $ids = []): array
    {
        if ($ids === []) {
            $statement = Database::connection()->query('SELECT id, name, erp_shop_id FROM mar_shop WHERE erp_shop_id IS NOT NULL ORDER BY name');
        } else {
            [$in, $bind] = Database::inClause($ids, 'shop');
            $statement = Database::connection()->prepare(sprintf('SELECT id, name, erp_shop_id FROM mar_shop WHERE id IN (%s) ORDER BY name', $in));
            $statement->execute($bind);
        }

        return array_map(static fn (array $row): array => [
            'id'        => (int) $row['id'],
            'name'      => (string) $row['name'],
            'erpShopId' => $row['erp_shop_id'] !== null ? (int) $row['erp_shop_id'] : null,
        ], $statement->fetchAll());
    }

    /**
     * Les coordonnées saisies des boutiques pour la dernière page du catalogue (`mar_catalogue_shop_contact`,
     * 17/11/2026) : ce que l'ERP ne porte pas. `mar_shop.id` → {phone2, webshopUrl, logoMediaId, holidayHoursFr,
     * holidayHoursNl} (horaires des fêtes : migration 054, 21/11/2026) et la page « Le magasin » {photoMediaId, mapsUrl,
     * openingHoursFr, openingHoursNl} (migration 055).
     *
     * @return array<int, array<string,mixed>>
     */
    public function shopContacts(): array
    {
        $out = [];
        $sql = 'SELECT shop_id, phone2, webshop_url, business_url, logo_media_id, photo_media_id, maps_url, hours_fr, hours_nl, holiday_hours_fr, holiday_hours_nl,
                       delivery_hours_fr, delivery_hours_nl
                FROM mar_catalogue_shop_contact';
        foreach (Database::connection()->query($sql)->fetchAll() as $row) {
            $out[(int) $row['shop_id']] = [
                'phone2'      => (string) ($row['phone2'] ?? ''),
                'webshopUrl'  => (string) ($row['webshop_url'] ?? ''),
                'logoMediaId' => $row['logo_media_id'] !== null ? (int) $row['logo_media_id'] : null,
                // La page « Le magasin » (migration 055, 21/11/2026) : photo, lien Google Maps, horaires d'ouverture.
                'photoMediaId' => $row['photo_media_id'] !== null ? (int) $row['photo_media_id'] : null,
                'mapsUrl'     => (string) ($row['maps_url'] ?? ''),
                'openingHoursFr' => (string) ($row['hours_fr'] ?? ''),
                'openingHoursNl' => (string) ($row['hours_nl'] ?? ''),
                'holidayHoursFr' => (string) ($row['holiday_hours_fr'] ?? ''),
                'holidayHoursNl' => (string) ($row['holiday_hours_nl'] ?? ''),
                // Le catalogue « Bureaux » (migration 056, 21/11/2026) : le lien de commande entreprise, la livraison au bureau.
                'businessUrl' => (string) ($row['business_url'] ?? ''),
                'deliveryHoursFr' => (string) ($row['delivery_hours_fr'] ?? ''),
                'deliveryHoursNl' => (string) ($row['delivery_hours_nl'] ?? ''),
            ];
        }

        return $out;
    }

    /**
     * Les coordonnées saisies d'une boutique (une ligne par boutique ; une chaîne vide est rangée null), sous les clés de
     * `shopContacts()`.
     *
     * @param array<string,mixed> $contact
     */
    public function saveShopContact(int $shopId, array $contact, int $userId): void
    {
        $columns = ['phone2' => 'phone2', 'webshopUrl' => 'webshop_url', 'logoMediaId' => 'logo_media_id', 'photoMediaId' => 'photo_media_id',
            'mapsUrl' => 'maps_url', 'openingHoursFr' => 'hours_fr', 'openingHoursNl' => 'hours_nl', 'holidayHoursFr' => 'holiday_hours_fr', 'holidayHoursNl' => 'holiday_hours_nl',
            'businessUrl' => 'business_url', 'deliveryHoursFr' => 'delivery_hours_fr', 'deliveryHoursNl' => 'delivery_hours_nl'];
        $bind = ['shop' => $shopId, 'user' => $userId > 0 ? $userId : null];
        foreach ($columns as $key => $column) {
            $value = $contact[$key] ?? null;
            $bind[$column] = $value === '' ? null : $value;
        }
        $names = implode(', ', array_values($columns));
        $values = implode(', ', array_map(static fn (string $c): string => ':' . $c, array_values($columns)));
        $updates = implode(', ', array_map(static fn (string $c): string => $c . ' = VALUES(' . $c . ')', array_values($columns)));
        $statement = Database::connection()->prepare(
            'INSERT INTO mar_catalogue_shop_contact (shop_id, ' . $names . ', updated_by) VALUES (:shop, ' . $values . ', :user)
             ON DUPLICATE KEY UPDATE ' . $updates . ', updated_by = VALUES(updated_by)'
        );
        $statement->execute($bind);
    }

    /** La boutique du module qui porte cet identifiant de caisse (une seule marque par réseau). */
    public function shopByErpId(int $erpShopId): ?array
    {
        $statement = Database::connection()->prepare('SELECT id, name, erp_shop_id FROM mar_shop WHERE erp_shop_id = :erp ORDER BY id LIMIT 1');
        $statement->execute(['erp' => $erpShopId]);
        $row = $statement->fetch();

        return $row === false ? null : ['id' => (int) $row['id'], 'name' => (string) $row['name'], 'erpShopId' => (int) $row['erp_shop_id']];
    }

    /**
     * Une campagne et les produits ERP de son offre (`mar_offer_item.sku_ref` = `erp-{id}`), dans
     * l'ordre de l'étape Prix. `null` : campagne inconnue.
     *
     * @return array{id:int, name:string, productIds: list<int>, shopIds: list<int>}|null
     */
    public function campaign(int $campaignId): ?array
    {
        $statement = Database::connection()->prepare('SELECT id, name FROM mar_campaign WHERE id = :id');
        $statement->execute(['id' => $campaignId]);
        $campaign = $statement->fetch();
        if ($campaign === false) {
            return null;
        }

        $items = Database::connection()->prepare(
            "SELECT oi.sku_ref FROM mar_campaign_offer o
             JOIN mar_campaign_offer_item coi ON coi.campaign_offer_id = o.id
             JOIN mar_offer_item oi ON oi.id = coi.offer_item_id
             WHERE o.campaign_id = :id ORDER BY o.id, coi.sort_order, coi.id"
        );
        $items->execute(['id' => $campaignId]);
        $ids = [];
        foreach ($items->fetchAll(PDO::FETCH_COLUMN) as $sku) {
            if (preg_match('/^erp-(\d+)$/', (string) $sku, $m) === 1) {
                $ids[(int) $m[1]] = (int) $m[1];
            }
        }

        $shops = Database::connection()->prepare('SELECT shop_id FROM mar_campaign_shop WHERE campaign_id = :id ORDER BY shop_id');
        $shops->execute(['id' => $campaignId]);

        return [
            'id'         => (int) $campaign['id'],
            'name'       => (string) $campaign['name'],
            'productIds' => array_values($ids),
            'shopIds'    => array_map('intval', $shops->fetchAll(PDO::FETCH_COLUMN)),
        ];
    }

    /** @return array<string,mixed> */
    private static function decode(array $row): array
    {
        $settings = json_decode((string) $row['settings'], true);
        $row['settings'] = is_array($settings) ? $settings : [];

        return $row;
    }
}
