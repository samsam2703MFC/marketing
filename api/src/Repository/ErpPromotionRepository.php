<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\ErpClient;
use Marketing\Support\Scope;

/**
 * Les promotions de l'ERP (TFBuddy), lues sur son API — jamais dans ses tables.
 *
 * Cinq familles, cinq routes du réalm admin, toutes soumises au droit
 * MENU.BUNDLE.MANAGE de l'ERP : bundles, « X achetés = Y » (buy-x-get-y),
 * promotions de quantité, remises programmées, campagnes de bons. Chaque liste
 * est paginée (`{items, pagination}`) et ne porte que l'en-tête d'une
 * promotion ; le détail (composition, magasins, créneaux) se lit promotion par
 * promotion — sauf pour les campagnes de bons, entières dans la liste.
 *
 * Les seules lectures en base sont celles du module : les noms des boutiques
 * (`mar_shop.erp_shop_id`) et des produits (`mar_offer_item.sku_ref` = « erp-<id> »),
 * et les boutiques ERP d'un franchisé, pour son périmètre.
 */
final class ErpPromotionRepository
{
    /** Famille → chemin de l'ERP, et si le détail se lit à part. */
    public const FAMILIES = [
        'bundle'            => ['/api/v1/admin/promotions/bundles', true],
        'buyXGetY'          => ['/api/v1/admin/promotions/buy-x-get-y', true],
        'quantity'          => ['/api/v1/admin/promotions/quantity', true],
        'scheduledDiscount' => ['/api/v1/admin/promotions/scheduled-product-discount', true],
        'voucher'           => ['/api/v1/admin/voucher-campaigns', false],
    ];

    private const LIMIT = 100;
    private const MAX_PAGES = 20;

    public function __construct(private readonly ErpClient $erp = new ErpClient())
    {
    }

    /**
     * Les promotions d'une famille, telles que l'ERP les rend, détail compris.
     *
     * @return list<array<string,mixed>>
     */
    public function family(string $family): array
    {
        [$path, $detail] = self::FAMILIES[$family];
        $rows = [];

        for ($page = 1; $page <= self::MAX_PAGES; $page++) {
            $payload = $this->erp->get($path, ['page' => $page, 'limit' => self::LIMIT]);
            $items   = ErpClient::rows($payload, ['items']);
            array_push($rows, ...$items);

            // La pagination annoncée fait foi : l'ERP peut servir moins que la limite demandée.
            $pagination = $payload['pagination'] ?? ($payload['data']['pagination'] ?? null);
            $pages      = is_array($pagination) ? (int) ($pagination['pages'] ?? 0) : 0;

            if ($items === [] || ($pages > 0 ? $page >= $pages : count($items) < self::LIMIT)) {
                break;
            }
        }

        if (!$detail) {
            return $rows;
        }

        foreach ($rows as $i => $row) {
            if (!isset($row['id'])) {
                continue;
            }

            $full = ErpClient::rows($this->erp->get($path . '/' . rawurlencode((string) $row['id'])));
            if ($full !== []) {
                $rows[$i] = array_merge($row, $full[0]);
            }
        }

        return $rows;
    }

    /**
     * Noms des boutiques du module, par identifiant ERP.
     *
     * @param  list<int> $erpShopIds
     * @return array<int,string>
     */
    public function shopNames(array $erpShopIds): array
    {
        if ($erpShopIds === []) {
            return [];
        }

        $marks = implode(',', array_fill(0, count($erpShopIds), '?'));
        $statement = Database::connection()->prepare(
            "SELECT erp_shop_id, name FROM mar_shop WHERE erp_shop_id IN ($marks)"
        );
        $statement->execute(array_values($erpShopIds));

        $names = [];
        foreach ($statement->fetchAll() as $row) {
            $names[(int) $row['erp_shop_id']] = (string) $row['name'];
        }

        return $names;
    }

    /**
     * Noms des produits du catalogue repris de l'ERP (`sku_ref` = « erp-<id> »).
     *
     * @param  list<int> $erpProductIds
     * @return array<int,string>
     */
    public function productNames(array $erpProductIds): array
    {
        if ($erpProductIds === []) {
            return [];
        }

        $refs  = array_map(static fn (int $id): string => 'erp-' . $id, $erpProductIds);
        $marks = implode(',', array_fill(0, count($refs), '?'));
        $statement = Database::connection()->prepare(
            "SELECT sku_ref, name FROM mar_offer_item WHERE sku_ref IN ($marks)"
        );
        $statement->execute($refs);

        $names = [];
        foreach ($statement->fetchAll() as $row) {
            $names[(int) substr((string) $row['sku_ref'], 4)] = (string) $row['name'];
        }

        return $names;
    }

    /**
     * Le périmètre, appliqué ici comme ailleurs : un franchisé ne voit que les
     * promotions de tout le réseau et celles qui visent une de ses boutiques.
     * Une campagne de bons n'a pas de boutiques : elle vaut pour le réseau.
     *
     * @param  list<array<string,mixed>> $promotions Promotions normalisées (`shopScope`, `shops`).
     * @return list<array<string,mixed>>
     */
    public function visibleTo(AuthContext $auth, array $promotions): array
    {
        $allowed = Scope::shopIds($auth);
        if ($allowed === null) {
            return $promotions;
        }

        $erpIds = [];
        if ($allowed !== []) {
            $marks = implode(',', array_fill(0, count($allowed), '?'));
            $statement = Database::connection()->prepare(
                "SELECT erp_shop_id FROM mar_shop WHERE id IN ($marks) AND erp_shop_id IS NOT NULL"
            );
            $statement->execute($allowed);
            $erpIds = array_map('intval', $statement->fetchAll(\PDO::FETCH_COLUMN));
        }

        return array_values(array_filter($promotions, static function (array $promotion) use ($erpIds): bool {
            if ($promotion['shopScope'] === 'all') {
                return true;
            }

            foreach ($promotion['shops'] as $shop) {
                if (in_array($shop['erpShopId'], $erpIds, true)) {
                    return true;
                }
            }

            return false;
        }));
    }
}
