<?php

declare(strict_types=1);

namespace Marketing\Support;

use PDO;

/**
 * Périmètre de données.
 *
 * « Un franchisé ne voit que ses boutiques » est une règle de sécurité, pas
 * d'affichage : elle s'applique dans le SQL, jamais dans le front. Un
 * FRANCHISEE qui appellerait directement l'API avec l'id d'une autre boutique
 * doit obtenir un 403, pas ses données.
 */
final class Scope
{
    /**
     * Boutiques visibles par l'appelant.
     *
     * @return list<int>|null `null` = aucune restriction (BRAND_ADMIN)
     */
    public static function shopIds(AuthContext $auth): ?array
    {
        if ($auth->isBrandAdmin()) {
            return null;
        }

        if ($auth->shopIds !== []) {
            return $auth->shopIds;
        }

        // Filet de sécurité si l'hôte n'a pas transmis la liste : on la relit.
        $statement = Database::connection()->prepare(
            'SELECT shop_id FROM mar_shop_user WHERE user_id = :user_id'
        );
        $statement->execute(['user_id' => $auth->userId]);

        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    /** Vrai si l'appelant a le droit de lire ou d'écrire sur cette boutique. */
    public static function allowsShop(AuthContext $auth, int $shopId): bool
    {
        $allowed = self::shopIds($auth);

        return $allowed === null || in_array($shopId, $allowed, true);
    }

    /**
     * Fragment SQL restreignant une colonne de boutique au périmètre.
     * Retourne une condition toujours vraie pour un BRAND_ADMIN.
     *
     * @return array{0:string, 1:array<string,int>}
     */
    public static function shopFilter(AuthContext $auth, string $column): array
    {
        $allowed = self::shopIds($auth);

        if ($allowed === null) {
            return ['1 = 1', []];
        }

        if ($allowed === []) {
            // Un franchisé sans boutique rattachée ne voit rien — surtout pas tout.
            return ['1 = 0', []];
        }

        [$placeholders, $bindings] = Database::inClause($allowed, 'scope_shop');

        return [sprintf('%s IN (%s)', $column, $placeholders), $bindings];
    }

    /**
     * Même filtre, appliqué aux campagnes : une campagne est visible si elle est
     * réseau, ou si l'une des boutiques du franchisé y participe.
     *
     * @return array{0:string, 1:array<string,int>}
     */
    public static function campaignFilter(AuthContext $auth, string $campaignAlias = 'c'): array
    {
        $allowed = self::shopIds($auth);

        if ($allowed === null) {
            return ['1 = 1', []];
        }

        if ($allowed === []) {
            return ['1 = 0', []];
        }

        [$placeholders, $bindings] = Database::inClause($allowed, 'scope_camp_shop');

        $sql = sprintf(
            '(%1$s.scope = \'RESEAU\' OR EXISTS (
                SELECT 1 FROM mar_campaign_shop cs
                WHERE cs.campaign_id = %1$s.id AND cs.shop_id IN (%2$s)
            ))',
            $campaignAlias,
            $placeholders
        );

        return [$sql, $bindings];
    }
}
