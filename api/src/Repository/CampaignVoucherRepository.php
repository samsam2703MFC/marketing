<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * Ce dont les bons d'une campagne ont besoin dans les tables du module.
 *
 * Boutique du module → boutique de l'ERP, et promotions de l'étape « Prix » →
 * ce qu'un bon peut déclencher. Servi aux bons de l'ancien moteur du webshop
 * (lecture) et aux bons de TFBuddy (ErpVoucherService), dont le lien avec la
 * campagne est, lui, dans mar_campaign_erp_voucher (ErpVoucherRepository).
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

}
