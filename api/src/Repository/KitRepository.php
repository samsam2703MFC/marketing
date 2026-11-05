<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Le kit des franchisés : ses versions, le contenu figé de chaque boutique,
 * leurs liens et leur lecture. Seul endroit avec du SQL pour ces tables.
 */
final class KitRepository
{
    /** @return list<array{version:int, created_at:string}> */
    public function versions(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT version, created_at FROM mar_campaign_kit WHERE campaign_id = :id ORDER BY version DESC'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map(static fn (array $r): array => ['version' => (int) $r['version'], 'created_at' => (string) $r['created_at']], $statement->fetchAll());
    }

    /**
     * Enregistre une version, avec le kit de chaque boutique, d'un coup.
     *
     * @param array<int,string> $payloads boutique → JSON
     */
    public function createVersion(int $campaignId, array $payloads, int $userId): int
    {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare('SELECT COALESCE(MAX(version), 0) + 1 FROM mar_campaign_kit WHERE campaign_id = :id FOR UPDATE');
            $statement->execute(['id' => $campaignId]);
            $version = (int) $statement->fetchColumn();
            $pdo->prepare('INSERT INTO mar_campaign_kit (campaign_id, version, created_at, created_by) VALUES (:c, :v, :at, :by)')
                ->execute(['c' => $campaignId, 'v' => $version, 'at' => gmdate('Y-m-d H:i:s'), 'by' => $userId]);
            $insert = $pdo->prepare('INSERT INTO mar_campaign_kit_shop (campaign_id, version, shop_id, payload) VALUES (:c, :v, :s, :p)');
            foreach ($payloads as $shopId => $json) {
                $insert->execute(['c' => $campaignId, 'v' => $version, 's' => $shopId, 'p' => $json]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return $version;
    }

    /** @return array<int,array<string,mixed>> boutique → lien */
    public function links(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT shop_id, salt, token_hash, expires_on FROM mar_campaign_kit_link WHERE campaign_id = :id'
        );
        $statement->execute(['id' => $campaignId]);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['shop_id']] = $row;
        }

        return $out;
    }

    public function saveLink(int $campaignId, int $shopId, string $salt, string $tokenHash, string $expiresOn): void
    {
        Database::connection()->prepare(
            'INSERT INTO mar_campaign_kit_link (campaign_id, shop_id, salt, token_hash, expires_on)
             VALUES (:c, :s, :salt, :hash, :exp)
             ON DUPLICATE KEY UPDATE expires_on = GREATEST(expires_on, VALUES(expires_on))'
        )->execute(['c' => $campaignId, 's' => $shopId, 'salt' => $salt, 'hash' => $tokenHash, 'exp' => $expiresOn]);
    }

    /** @return array<int,array{version:int, read_at:?string}> boutique → lecture de la dernière version */
    public function reads(int $campaignId, int $version): array
    {
        $statement = Database::connection()->prepare(
            'SELECT shop_id, version, read_at FROM mar_campaign_kit_shop WHERE campaign_id = :c AND version = :v'
        );
        $statement->execute(['c' => $campaignId, 'v' => $version]);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['shop_id']] = ['version' => (int) $row['version'], 'read_at' => $row['read_at']];
        }

        return $out;
    }

    /**
     * Le kit d'un lien : sa dernière version, s'il n'a pas expiré.
     *
     * @return array{campaign_id:int, shop_id:int, version:int, payload:string, read_at:?string, created_at:string}|null
     */
    public function byToken(string $tokenHash, string $today): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT l.campaign_id, l.shop_id, ks.version, ks.payload, ks.read_at, k.created_at
               FROM mar_campaign_kit_link l
               JOIN mar_campaign_kit_shop ks ON ks.campaign_id = l.campaign_id AND ks.shop_id = l.shop_id
               JOIN mar_campaign_kit k       ON k.campaign_id = ks.campaign_id AND k.version = ks.version
              WHERE l.token_hash = :hash AND l.expires_on >= :today
              ORDER BY ks.version DESC
              LIMIT 1'
        );
        $statement->execute(['hash' => $tokenHash, 'today' => $today]);
        $row = $statement->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'campaign_id' => (int) $row['campaign_id'], 'shop_id' => (int) $row['shop_id'], 'version' => (int) $row['version'],
            'payload' => (string) $row['payload'], 'read_at' => $row['read_at'], 'created_at' => (string) $row['created_at'],
        ];
    }

    /** La première lecture d'une version reste : relire ne la déplace pas. */
    public function markRead(int $campaignId, int $shopId, int $version): void
    {
        Database::connection()->prepare(
            'UPDATE mar_campaign_kit_shop SET read_at = :at
              WHERE campaign_id = :c AND shop_id = :s AND version = :v AND read_at IS NULL'
        )->execute(['at' => gmdate('Y-m-d H:i:s'), 'c' => $campaignId, 's' => $shopId, 'v' => $version]);
    }
}
