<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;

/**
 * Écrans « Réseau » : fidélité/CRM, présence locale, kit local.
 *
 * Les deux premiers sont marqués « À développer » dans la maquette. Leur
 * structure existe, on la lit telle quelle plutôt que d'inventer des chiffres —
 * un écran vide qui le dit vaut mieux qu'un écran plein qui ment.
 */
final class NetworkRepository
{
    /**
     * Segments RFM, avec l'effectif réellement calculé.
     *
     * @return list<array<string,mixed>>
     */
    public function segments(): array
    {
        $rows = Database::connection()->query(
            'SELECT s.id, s.code, s.label, s.color_hex,
                    COUNT(cs.customer_id) AS customers_count
               FROM mar_crm_segment s
               LEFT JOIN mar_crm_customer_segment cs ON cs.segment_id = s.id
              WHERE s.is_active = 1
              GROUP BY s.id, s.code, s.label, s.color_hex, s.sort_order
              ORDER BY s.sort_order'
        )->fetchAll();

        return array_map([$this, 'cast'], $rows);
    }

    /**
     * Volumétrie clients, dans le périmètre de l'appelant.
     *
     * @return array<string,mixed>
     */
    public function customerSummary(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'home_shop_id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT COUNT(*)                                   AS customers,
                    COALESCE(SUM(opt_in_marketing), 0)         AS opted_in,
                    COALESCE(SUM(total_spent_amount), 0)       AS total_spent,
                    COALESCE(AVG(NULLIF(orders_count, 0)), 0)  AS avg_orders
               FROM mar_crm_customer
              WHERE home_shop_id IS NULL OR %s',
            $scopeSql
        ));
        $statement->execute($bindings);

        return $this->cast($statement->fetch() ?: []);
    }

    /**
     * Présence locale par boutique et plateforme.
     *
     * @return list<array<string,mixed>>
     */
    public function presence(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'p.shop_id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT p.id, p.platform, p.rating_avg, p.reviews_count,
                    p.completeness_pct, p.last_synced_at,
                    s.name AS shop_name,
                    COUNT(r.id) AS pending_replies
               FROM mar_shop_presence p
               JOIN mar_shop s ON s.id = p.shop_id
               LEFT JOIN mar_review r
                      ON r.shop_presence_id = p.id AND r.reply_status = \'pending\'
              WHERE %s
              GROUP BY p.id, p.platform, p.rating_avg, p.reviews_count,
                       p.completeness_pct, p.last_synced_at, s.name
              ORDER BY s.name, p.platform',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Derniers avis reçus, dans le périmètre.
     *
     * @return list<array<string,mixed>>
     */
    public function reviews(AuthContext $auth, int $limit = 5): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'p.shop_id');

        // La limite est interpolée après contrôle : un entier borné n'est pas
        // une donnée utilisateur, et MySQL refuse un paramètre lié en LIMIT
        // quand l'émulation des requêtes préparées est désactivée.
        $limit = max(1, min(50, $limit));

        $statement = Database::connection()->prepare(sprintf(
            'SELECT r.id, r.author_name, r.rating, r.body, r.published_at, r.reply_status,
                    s.name AS shop_name, p.platform
               FROM mar_review r
               JOIN mar_shop_presence p ON p.id = r.shop_presence_id
               JOIN mar_shop s          ON s.id = p.shop_id
              WHERE %s
              ORDER BY r.published_at DESC
              LIMIT %d',
            $scopeSql,
            $limit
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Kits clé-en-main publiés, avec leurs activations.
     *
     * @return list<array<string,mixed>>
     */
    public function kits(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'ka.shop_id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT k.id, k.name, k.description, k.default_budget_amount, k.is_published,
                    t.label AS type_label,
                    COUNT(DISTINCT ka.id) AS activations,
                    COUNT(DISTINCT kas.id) AS assets_count
               FROM mar_kit k
               LEFT JOIN mar_campaign_type t ON t.id = k.campaign_type_id
               LEFT JOIN mar_kit_activation ka ON ka.kit_id = k.id AND (%s)
               LEFT JOIN mar_kit_asset kas     ON kas.kit_id = k.id
              WHERE k.is_published = 1
              GROUP BY k.id, k.name, k.description, k.default_budget_amount,
                       k.is_published, t.label
              ORDER BY k.name',
            $scopeSql
        ));
        $statement->execute($bindings);

        $kits = array_map([$this, 'cast'], $statement->fetchAll());
        foreach ($kits as &$kit) {
            $kit['is_published'] = (bool) $kit['is_published'];
        }

        return $kits;
    }

    /**
     * @param  array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function cast(array $row): array
    {
        foreach ($row as $key => $value) {
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (
                str_ends_with($key, '_amount') || str_ends_with($key, '_pct')
                || in_array($key, ['rating_avg', 'total_spent', 'avg_orders'], true)
            ) {
                $row[$key] = (float) $value;
            } elseif (
                $key === 'id' || str_ends_with($key, '_id') || str_ends_with($key, '_count')
                || in_array($key, ['customers', 'opted_in', 'rating', 'activations', 'pending_replies'], true)
            ) {
                $row[$key] = (int) $value;
            }
        }

        return $row;
    }
}
