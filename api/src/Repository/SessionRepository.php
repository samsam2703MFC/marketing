<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * Ce que la connexion lit dans le module : les boutiques qui répondent aux
 * identifiants de l'ERP d'un compte de boutique.
 */
final class SessionRepository
{
    /**
     * Les boutiques du module pour des identifiants de boutique de l'ERP : par
     * `erp_shop_id`, ou par le code `erp-N` que la reprise leur donne.
     *
     * @param  list<int> $erpIds
     * @return list<int>
     */
    public function shopsForErpIds(array $erpIds): array
    {
        $erpIds = array_values(array_unique(array_filter(array_map('intval', $erpIds), static fn (int $id): bool => $id > 0)));
        if ($erpIds === []) {
            return [];
        }

        $marks    = implode(',', array_fill(0, count($erpIds), '?'));
        $bindings = [...$erpIds, ...array_map(static fn (int $id): string => 'erp-' . $id, $erpIds)];

        $statement = Database::connection()->prepare(
            "SELECT id FROM mar_shop WHERE erp_shop_id IN ($marks) OR code IN ($marks) ORDER BY id"
        );
        $statement->execute($bindings);

        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }
}
