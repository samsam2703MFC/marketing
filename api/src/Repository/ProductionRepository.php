<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Le fil de production d'une campagne validée : ce qui la compose (supports
 * cochés, consignes, tenues, prime…) et l'état de chaque section, boutique par
 * boutique pour les supports propres à chacune.
 *
 * Seul endroit avec du SQL pour ces tables. La visibilité de la campagne se
 * vérifie avant (CampaignRepository::find, qui applique le périmètre).
 */
final class ProductionRepository
{
    /**
     * Les supports cochés de la campagne, avec leur famille et leur délai.
     *
     * @return list<array<string,mixed>>
     */
    public function channels(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT ch.code, ch.label, ch.grp, ch.description, ch.lead_days, ch.editor, ch.is_paid,
                    cc.quantity, cc.details, cc.budget_amount, a.name AS agency_name
               FROM mar_campaign_channel cc
               JOIN mar_channel ch    ON ch.id = cc.channel_id
               LEFT JOIN mar_agency a ON a.id = cc.agency_id
              WHERE cc.campaign_id = :id AND cc.is_enabled = 1
              ORDER BY ch.sort_order, ch.id'
        );
        $statement->execute(['id' => $campaignId]);

        return $statement->fetchAll();
    }

    /**
     * Les boutiques de la campagne. Une campagne réseau sans boutique choisie
     * vise toutes les boutiques de la marque.
     *
     * @param  list<int>|null $only Restreint aux boutiques d'un franchisé.
     * @return list<array<string,mixed>>
     */
    public function shops(int $campaignId, int $brandId, ?array $only = null): array
    {
        $pdo = Database::connection();
        $statement = $pdo->prepare(
            'SELECT s.id, s.name, s.city, s.erp_shop_id, cs.target_pieces, cs.staff_headcount
               FROM mar_campaign_shop cs
               JOIN mar_shop s ON s.id = cs.shop_id
              WHERE cs.campaign_id = :id
              ORDER BY s.name'
        );
        $statement->execute(['id' => $campaignId]);
        $rows = $statement->fetchAll();
        if ($rows === []) {
            $statement = $pdo->prepare(
                'SELECT s.id, s.name, s.city, s.erp_shop_id, NULL AS target_pieces, NULL AS staff_headcount
                   FROM mar_shop s WHERE s.brand_id = :brand ORDER BY s.name'
            );
            $statement->execute(['brand' => $brandId]);
            $rows = $statement->fetchAll();
        }
        if ($only !== null) {
            $rows = array_values(array_filter($rows, static fn (array $r): bool => in_array((int) $r['id'], $only, true)));
        }

        return $rows;
    }

    /** @return array<string,array<string,mixed>> section → ligne */
    public function states(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT section, status, note, validated_at, validated_by, updated_at FROM mar_campaign_production WHERE campaign_id = :id'
        );
        $statement->execute(['id' => $campaignId]);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(string) $row['section']] = $row;
        }

        return $out;
    }

    /** @return array<string,array<int,array<string,mixed>>> section → boutique → ligne */
    public function shopStates(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT section, shop_id, status, note, updated_at FROM mar_campaign_production_shop WHERE campaign_id = :id'
        );
        $statement->execute(['id' => $campaignId]);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(string) $row['section']][(int) $row['shop_id']] = $row;
        }

        return $out;
    }

    /**
     * Les bâches et cadres d'affiche déclarés des boutiques.
     *
     * @param  list<int> $shopIds
     * @return array<int,list<array<string,mixed>>> boutique → supports
     */
    public function shopSupports(array $shopIds): array
    {
        if ($shopIds === []) {
            return [];
        }
        [$placeholders, $bindings] = Database::inClause($shopIds, 'shop');
        $statement = Database::connection()->prepare(sprintf(
            'SELECT shop_id, kind, placement, width_cm, height_cm, paper_format, quantity, material, fixing, note
               FROM mar_shop_support WHERE shop_id IN (%s) ORDER BY shop_id, kind, sort_order, id',
            $placeholders
        ));
        $statement->execute($bindings);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['shop_id']][] = $row;
        }

        return $out;
    }

    public function saveState(int $campaignId, string $section, string $status, ?string $note, int $userId): void
    {
        $validated = $status === 'validated';
        Database::connection()->prepare(
            'INSERT INTO mar_campaign_production (campaign_id, section, status, note, validated_at, validated_by, updated_by)
             VALUES (:campaign, :section, :status, :note, :vat, :vby, :uby)
             ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note),
                    validated_at = VALUES(validated_at), validated_by = VALUES(validated_by), updated_by = VALUES(updated_by)'
        )->execute([
            'campaign' => $campaignId, 'section' => $section, 'status' => $status, 'note' => $note,
            'vat' => $validated ? gmdate('Y-m-d H:i:s') : null, 'vby' => $validated ? $userId : null, 'uby' => $userId,
        ]);
    }

    public function saveShopState(int $campaignId, string $section, int $shopId, string $status, ?string $note, int $userId): void
    {
        Database::connection()->prepare(
            'INSERT INTO mar_campaign_production_shop (campaign_id, section, shop_id, status, note, updated_by)
             VALUES (:campaign, :section, :shop, :status, :note, :uby)
             ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), updated_by = VALUES(updated_by)'
        )->execute([
            'campaign' => $campaignId, 'section' => $section, 'shop' => $shopId, 'status' => $status, 'note' => $note, 'uby' => $userId,
        ]);
        // Un BAT qui repart n'est plus validé : la section ne peut pas rester close.
        if ($status !== 'validated') {
            Database::connection()->prepare(
                "UPDATE mar_campaign_production SET status = 'doing', validated_at = NULL, validated_by = NULL, updated_by = :uby
                  WHERE campaign_id = :campaign AND section = :section AND status = 'validated'"
            )->execute(['campaign' => $campaignId, 'section' => $section, 'uby' => $userId]);
        }
    }

    public function saveHeadcount(int $campaignId, int $shopId, ?int $headcount): void
    {
        Database::connection()->prepare(
            'UPDATE mar_campaign_shop SET staff_headcount = :n WHERE campaign_id = :campaign AND shop_id = :shop'
        )->execute(['n' => $headcount, 'campaign' => $campaignId, 'shop' => $shopId]);
    }
}
