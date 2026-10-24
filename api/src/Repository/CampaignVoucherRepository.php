<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * Ce dont les bons d'une campagne ont besoin dans les tables du module.
 *
 * Le bon, lui, n'est pas ici — ni son lien avec la campagne : tous deux vivent
 * dans le webshop, lus et écrits par son API. Ce dépôt ne fait que traduire
 * vers le webshop : boutique du module → boutique de l'ERP, référence du
 * catalogue → produit de l'ERP, identifiant de campagne → son nom, promotions
 * de l'étape « Prix » → ce qu'un bon peut déclencher.
 */
final class CampaignVoucherRepository
{
    /**
     * Identifiants ERP de boutiques du module (mar_shop.erp_shop_id). Une
     * boutique jamais rapprochée de l'ERP n'en a pas : elle est omise.
     *
     * @param  list<int> $shopIds
     * @return list<int>
     */
    public function erpShopIds(array $shopIds): array
    {
        if ($shopIds === []) {
            return [];
        }

        [$placeholders, $bindings] = Database::inClause($shopIds, 'shop');
        $statement = Database::connection()->prepare(sprintf(
            'SELECT DISTINCT erp_shop_id FROM mar_shop WHERE id IN (%s) AND erp_shop_id IS NOT NULL ORDER BY erp_shop_id',
            $placeholders
        ));
        $statement->execute($bindings);

        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    /** @return list<int> Boutiques (du module) d'une campagne. */
    public function campaignShopIds(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT shop_id FROM mar_campaign_shop WHERE campaign_id = :campaign ORDER BY shop_id'
        );
        $statement->execute(['campaign' => $campaignId]);

        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * Le produit de l'ERP derrière une référence du catalogue (« erp-<id> »).
     * Null pour une saisie libre ou une gamme : ce ne sont pas des produits que
     * le panier connaît.
     *
     * @return array{erp_product_id:int, name:string}|null
     */
    public function erpProduct(int $offerItemId): ?array
    {
        $statement = Database::connection()->prepare(
            "SELECT sku_ref, name FROM mar_offer_item WHERE id = :id AND category = 'produit'"
        );
        $statement->execute(['id' => $offerItemId]);
        $row = $statement->fetch();

        if ($row === false || preg_match('/^erp-(\d+)$/', (string) $row['sku_ref'], $m) !== 1) {
            return null;
        }

        return ['erp_product_id' => (int) $m[1], 'name' => (string) $row['name']];
    }

    /**
     * Les promotions de l'étape « Prix » d'une campagne : une par ligne d'offre
     * qui porte une mécanique, avec le produit ERP derrière la référence du
     * catalogue (null pour une saisie libre ou une gamme) et les conditions
     * communes de l'offre (plafond par ticket, cumul).
     *
     * @return list<array{offer_item_id:int, label:string, mechanic:string, mechanic_label:string,
     *                    baseline_price:?float, discount_pct:?float, fixed_price:?float, buy_qty:?int, get_qty:?int,
     *                    erp_product_id:?int, max_qty_per_ticket:?int, is_cumulative:bool}>
     */
    public function campaignPromotions(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT ci.offer_item_id, ci.label, ci.mechanic_type, ci.discount_pct, ci.fixed_price,
                    ci.buy_qty, ci.get_qty, ci.baseline_price, oi.sku_ref, oi.category,
                    pm.label AS mechanic_label, co.max_qty_per_ticket, co.is_cumulative
               FROM mar_campaign_offer co
               JOIN mar_campaign_offer_item ci       ON ci.campaign_offer_id = co.id
               LEFT JOIN mar_offer_item oi           ON oi.id = ci.offer_item_id
               LEFT JOIN mar_promotion_mechanic pm   ON pm.code = ci.mechanic_type
              WHERE co.campaign_id = :campaign
                AND ci.mechanic_type IS NOT NULL
                AND ci.offer_item_id IS NOT NULL
              ORDER BY co.id, ci.sort_order, ci.id'
        );
        $statement->execute(['campaign' => $campaignId]);

        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $erp = ($row['category'] ?? null) === 'produit'
                && preg_match('/^erp-(\d+)$/', (string) $row['sku_ref'], $m) === 1 ? (int) $m[1] : null;
            $out[] = [
                'offer_item_id'      => (int) $row['offer_item_id'],
                'label'              => (string) $row['label'],
                'mechanic'           => (string) $row['mechanic_type'],
                'mechanic_label'     => (string) ($row['mechanic_label'] ?? $row['mechanic_type']),
                'baseline_price'     => $row['baseline_price'] === null ? null : (float) $row['baseline_price'],
                'discount_pct'       => $row['discount_pct'] === null ? null : (float) $row['discount_pct'],
                'fixed_price'        => $row['fixed_price'] === null ? null : (float) $row['fixed_price'],
                'buy_qty'            => $row['buy_qty'] === null ? null : (int) $row['buy_qty'],
                'get_qty'            => $row['get_qty'] === null ? null : (int) $row['get_qty'],
                'erp_product_id'     => $erp,
                'max_qty_per_ticket' => $row['max_qty_per_ticket'] === null ? null : (int) $row['max_qty_per_ticket'],
                'is_cumulative'      => (bool) $row['is_cumulative'],
            ];
        }

        return $out;
    }

    /**
     * Le nom des campagnes, pour dire qui suit un bon.
     *
     * @param  list<int> $ids
     * @return array<int, string>
     */
    public function campaignNames(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return [];
        }

        [$placeholders, $bindings] = Database::inClause($ids, 'campaign');
        $statement = Database::connection()->prepare(sprintf(
            'SELECT id, name FROM mar_campaign WHERE id IN (%s)',
            $placeholders
        ));
        $statement->execute($bindings);

        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['id']] = (string) $row['name'];
        }

        return $out;
    }
}
