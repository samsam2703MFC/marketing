<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Les conditions du bon de commande de chaque boutique (migration 057, `mar_catalogue_order_conditions`) — seul endroit
 * avec du SQL pour elles. Une ligne par boutique ; pas de ligne : la boutique n'a rien réglé.
 *
 * Les lignes sortent toujours sous la même forme, clés dans le même ordre (`row()`), quel que soit le moteur.
 */
final class CatalogueOrderConditionsRepository
{
    private const COLUMNS = 'shop_id, lead_value, lead_unit, deposit_pct, holiday_deadlines, pickup, delivery, delivery_radius_km, delivery_fee_cents, note_fr, note_nl, updated_at';

    /** @return array<string,mixed>|null */
    public function find(int $shopId): ?array
    {
        $statement = Database::connection()->prepare('SELECT ' . self::COLUMNS . ' FROM mar_catalogue_order_conditions WHERE shop_id = :s');
        $statement->execute(['s' => $shopId]);
        $row = $statement->fetch();

        return $row === false ? null : self::row($row);
    }

    /**
     * Les boutiques qui ont réglé leurs conditions, par identifiant de boutique croissant.
     *
     * @return array{items: list<array<string,mixed>>, total:int}
     */
    public function page(int $page, int $perPage): array
    {
        $pdo = Database::connection();
        $total = (int) $pdo->query('SELECT COUNT(*) FROM mar_catalogue_order_conditions')->fetchColumn();
        $statement = $pdo->prepare('SELECT ' . self::COLUMNS . ' FROM mar_catalogue_order_conditions ORDER BY shop_id LIMIT :l OFFSET :o');
        $statement->bindValue('l', $perPage, \PDO::PARAM_INT);
        $statement->bindValue('o', ($page - 1) * $perPage, \PDO::PARAM_INT);
        $statement->execute();

        return ['items' => array_map(self::row(...), $statement->fetchAll()), 'total' => $total];
    }

    /** Remplace les conditions de la boutique (validées par le service). @param array<string,mixed> $c */
    public function save(int $shopId, array $c): void
    {
        $sql = 'INSERT INTO mar_catalogue_order_conditions (shop_id, lead_value, lead_unit, deposit_pct, holiday_deadlines, pickup, delivery, delivery_radius_km, delivery_fee_cents, note_fr, note_nl)
                VALUES (:s, :lv, :lu, :dp, :hd, :pk, :dl, :dr, :df, :nf, :nn)
                ON DUPLICATE KEY UPDATE lead_value = VALUES(lead_value), lead_unit = VALUES(lead_unit), deposit_pct = VALUES(deposit_pct),
                    holiday_deadlines = VALUES(holiday_deadlines), pickup = VALUES(pickup), delivery = VALUES(delivery),
                    delivery_radius_km = VALUES(delivery_radius_km), delivery_fee_cents = VALUES(delivery_fee_cents),
                    note_fr = VALUES(note_fr), note_nl = VALUES(note_nl), updated_at = CURRENT_TIMESTAMP';
        $deadlines = array_map(static fn (array $d): array => [$d['for'], $d['until']], $c['holidayDeadlines']);
        Database::connection()->prepare($sql)->execute([
            's'  => $shopId,
            'lv' => $c['minDelay']['value'] ?? null,
            'lu' => $c['minDelay']['unit'] ?? null,
            'dp' => $c['depositPct'],
            'hd' => $deadlines === [] ? null : json_encode($deadlines),
            'pk' => $c['pickup'] ? 1 : 0,
            'dl' => $c['delivery']['enabled'] ? 1 : 0,
            'dr' => $c['delivery']['radiusKm'],
            'df' => $c['delivery']['feeCents'],
            'nf' => $c['note']['fr'] !== '' ? $c['note']['fr'] : null,
            'nn' => $c['note']['nl'] !== '' ? $c['note']['nl'] : null,
        ]);
    }

    public function delete(int $shopId): void
    {
        Database::connection()->prepare('DELETE FROM mar_catalogue_order_conditions WHERE shop_id = :s')->execute(['s' => $shopId]);
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function row(array $r): array
    {
        $deadlines = [];
        $raw = json_decode((string) ($r['holiday_deadlines'] ?? ''), true);
        foreach (is_array($raw) ? $raw : [] as $pair) {
            if (is_array($pair) && isset($pair[0], $pair[1]) && is_string($pair[0]) && is_string($pair[1])) {
                $deadlines[] = ['for' => $pair[0], 'until' => $pair[1]];
            }
        }

        return [
            'shopId'           => (int) $r['shop_id'],
            'minDelay'         => $r['lead_value'] !== null && $r['lead_unit'] !== null ? ['value' => (int) $r['lead_value'], 'unit' => (string) $r['lead_unit']] : null,
            'depositPct'       => $r['deposit_pct'] !== null ? (int) $r['deposit_pct'] : null,
            'holidayDeadlines' => $deadlines,
            'pickup'           => (bool) (int) $r['pickup'],
            'delivery'         => [
                'enabled'  => (bool) (int) $r['delivery'],
                'radiusKm' => $r['delivery_radius_km'] !== null ? (int) $r['delivery_radius_km'] : null,
                'feeCents' => $r['delivery_fee_cents'] !== null ? (int) $r['delivery_fee_cents'] : null,
            ],
            'note'             => ['fr' => (string) ($r['note_fr'] ?? ''), 'nl' => (string) ($r['note_nl'] ?? '')],
            'updatedAt'        => (string) $r['updated_at'],
        ];
    }
}
