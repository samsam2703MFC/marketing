<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Le lien entre une campagne et ses bons de l'ERP (mar_campaign_erp_voucher).
 * Le bon lui-même — statut, codes, utilisations — se relit dans l'ERP.
 */
final class ErpVoucherRepository
{
    /** @return list<array<string,mixed>> */
    public function forCampaign(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT * FROM mar_campaign_erp_voucher WHERE campaign_id = :id ORDER BY id DESC'
        );
        $statement->execute(['id' => $campaignId]);

        return $statement->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function find(int $campaignId, int $id): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT * FROM mar_campaign_erp_voucher WHERE campaign_id = :campaign AND id = :id'
        );
        $statement->execute(['campaign' => $campaignId, 'id' => $id]);
        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $row */
    public function insert(array $row): int
    {
        Database::connection()->prepare(
            'INSERT INTO mar_campaign_erp_voucher
                (campaign_id, offer_item_id, erp_voucher_campaign_id, erp_promotion_id, promotion_family, name, code_type, shared_code, codes_requested, created_by)
             VALUES (:campaign_id, :offer_item_id, :erp_voucher_campaign_id, :erp_promotion_id, :promotion_family, :name, :code_type, :shared_code, :codes_requested, :created_by)'
        )->execute($row);

        return (int) Database::connection()->lastInsertId();
    }
}
