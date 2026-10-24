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
 * catalogue → produit de l'ERP, identifiant de campagne → son nom.
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
