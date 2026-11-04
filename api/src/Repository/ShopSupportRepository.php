<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use PDO;

/**
 * Les bâches et les cadres d'affiche de chaque boutique (`mar_shop_support`) :
 * déclarés une fois, repris par chaque campagne. Seul endroit avec leur SQL.
 *
 * Périmètre appliqué ici : le réseau voit toutes les boutiques, une identité de
 * boutique les siennes seulement.
 */
final class ShopSupportRepository
{
    private const COLUMNS = 'ss.id, ss.shop_id, sh.name AS shop_name, ss.kind, ss.placement, ss.width_cm, ss.height_cm,
                             ss.paper_format, ss.quantity, ss.material, ss.fixing, ss.note, ss.sort_order, ss.updated_at';

    /**
     * @param array{shop?:int, kind?:string} $filters
     * @return array{rows:list<array<string,mixed>>, total:int}
     */
    public function page(AuthContext $auth, array $filters, int $page, int $perPage): array
    {
        [$where, $params] = $this->where($auth, $filters);
        $pdo = Database::connection();

        $count = $pdo->prepare('SELECT COUNT(*) FROM mar_shop_support ss WHERE ' . $where);
        $count->execute($params);

        $statement = $pdo->prepare(
            'SELECT ' . self::COLUMNS . ' FROM mar_shop_support ss JOIN mar_shop sh ON sh.id = ss.shop_id
              WHERE ' . $where . ' ORDER BY sh.name, ss.shop_id, ss.kind, ss.sort_order, ss.id LIMIT :limit OFFSET :offset'
        );
        foreach ($params as $key => $value) {
            $statement->bindValue($key, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->bindValue('limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue('offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $statement->execute();

        return ['rows' => $statement->fetchAll(), 'total' => (int) $count->fetchColumn()];
    }

    /** La boutique existe-t-elle, et l'appelant la voit-il ? */
    public function shopVisible(AuthContext $auth, int $shopId): bool
    {
        if (!$auth->isBrandAdmin() && !in_array($shopId, $auth->shopIds, true)) {
            return false;
        }
        $statement = Database::connection()->prepare('SELECT 1 FROM mar_shop WHERE id = :id');
        $statement->execute(['id' => $shopId]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * Remplace les supports d'une boutique (dans une transaction : la liste change
     * d'un coup, jamais à moitié).
     *
     * @param list<array<string,mixed>> $supports Lignes déjà validées (colonnes de la table).
     */
    public function replace(int $shopId, array $supports, int $userId): void
    {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM mar_shop_support WHERE shop_id = :shop')->execute(['shop' => $shopId]);
            $insert = $pdo->prepare(
                'INSERT INTO mar_shop_support (shop_id, kind, placement, width_cm, height_cm, paper_format, quantity, material, fixing, note, sort_order, updated_by)
                 VALUES (:shop_id, :kind, :placement, :width_cm, :height_cm, :paper_format, :quantity, :material, :fixing, :note, :sort_order, :updated_by)'
            );
            foreach (array_values($supports) as $i => $row) {
                $insert->execute($row + ['shop_id' => $shopId, 'sort_order' => $i, 'updated_by' => $userId > 0 ? $userId : null]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * @param array{shop?:int, kind?:string} $filters
     * @return array{0:string, 1:array<string,int|string>}
     */
    private function where(AuthContext $auth, array $filters): array
    {
        $where  = ['1 = 1'];
        $params = [];
        if (!$auth->isBrandAdmin()) {
            if ($auth->shopIds === []) {
                return ['1 = 0', []];
            }
            $keys = [];
            foreach (array_values($auth->shopIds) as $i => $shopId) {
                $keys[] = ':scope' . $i;
                $params['scope' . $i] = $shopId;
            }
            $where[] = 'ss.shop_id IN (' . implode(', ', $keys) . ')';
        }
        if (isset($filters['shop'])) {
            $where[] = 'ss.shop_id = :f_shop';
            $params['f_shop'] = $filters['shop'];
        }
        if (isset($filters['kind'])) {
            $where[] = 'ss.kind = :f_kind';
            $params['f_kind'] = $filters['kind'];
        }

        return [implode(' AND ', $where), $params];
    }
}
