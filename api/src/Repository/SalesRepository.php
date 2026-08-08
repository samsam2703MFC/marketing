<?php

declare(strict_types=1);

namespace Marketing\Repository;

use DateTimeImmutable;
use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Env;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Ventes réelles du réseau, lues dans l'ERP.
 *
 * L'étape « Objectifs » de l'assistant s'appuie dessus : fixer un objectif de
 * pièces sans voir ce qui s'est réellement vendu reviendrait à choisir un
 * chiffre au hasard. Les tables sont celles de la caisse — `transaction`
 * (boutique, horodatage) et `transaction_product` (produit, quantité) —
 * nommées en configuration et résolues comme dans la reprise ERP : colonnes
 * découvertes dans `information_schema`, jamais supposées.
 *
 * L'absence des tables n'est pas une erreur : une installation sans historique
 * répond des zéros et l'explique, plutôt que de bloquer la saisie d'objectifs.
 */
final class SalesRepository
{
    /** @var array<string, list<string>> */
    private const TRANSACTION_COLUMNS = [
        'id'   => ['id', 'id_transaction', 'transaction_id'],
        'shop' => ['id_shop', 'shop_id', 'id_franchisee_shop'],
        'date' => ['insert_timestamp', 'created_at', 'sale_date', 'sold_at', 'timestamp'],
    ];

    /** @var array<string, list<string>> */
    private const LINE_COLUMNS = [
        'transaction' => ['id_transaction', 'transaction_id'],
        'product'     => ['id_product', 'product_id'],
        'quantity'    => ['quantity', 'qty'],
    ];

    /**
     * Quantités vendues par boutique et par produit sur une période.
     *
     * @param  list<int> $itemIds Références `mar_offer_item` de l'offre.
     * @return array<string, mixed>
     */
    public function quantities(
        AuthContext $auth,
        array $itemIds,
        string $from,
        string $to,
        bool $compare,
    ): array {
        $connection = Database::connection();

        // Boutiques du périmètre de l'appelant — toutes listées, y compris
        // sans vente : un objectif se pose aussi sur une boutique qui part de
        // zéro. `erp_shop_id` fait le pont avec la caisse.
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 's.id');
        $statement = $connection->prepare(sprintf(
            'SELECT s.id, s.name, s.erp_shop_id FROM mar_shop s WHERE %s ORDER BY s.name',
            $scopeSql
        ));
        $statement->execute($bindings);
        $shops = $statement->fetchAll();

        // Seuls les produits comptent des pièces : la gamme saisonnière glissée
        // dans l'offre n'a rien à faire dans un tableau de quantités.
        $products = [];
        if ($itemIds !== []) {
            [$inSql, $inBindings] = Database::inClause($itemIds, 'item');
            $lookup = $connection->prepare(sprintf(
                "SELECT id, sku_ref, name FROM mar_offer_item
                  WHERE id IN (%s) AND category = 'produit'
                  ORDER BY detail IS NULL, detail, name",
                $inSql
            ));
            $lookup->execute($inBindings);
            $products = $lookup->fetchAll();
        }

        $empty = [
            'from'     => $from,
            'to'       => $to,
            'compare'  => $compare,
            'products' => array_map(
                static fn (array $product): array => [
                    'item_id' => (int) $product['id'],
                    'name'    => (string) $product['name'],
                ],
                $products
            ),
            'shops'    => [],
            'network'  => [
                'by_product'          => (object) [],
                'by_product_previous' => null,
                'total'               => 0,
                'total_previous'      => null,
                'tickets'             => 0,
                'tickets_by_product'  => (object) [],
            ],
            'source'   => null,
            'warning'  => null,
        ];

        if ($products === []) {
            return $empty;
        }

        // Produit ERP → référence de catalogue, par le `sku_ref` de la reprise.
        $itemByErpProduct = [];
        foreach ($products as $product) {
            if (preg_match('/^erp-(\d+)$/', (string) $product['sku_ref'], $match) === 1) {
                $itemByErpProduct[(int) $match[1]] = (int) $product['id'];
            }
        }

        $current       = [];
        $previous      = [];
        $ticketsByItem = [];
        $shopTickets   = [];
        $source        = null;
        $warning       = null;

        try {
            [$linesSource, $transactionsSource, $lineColumns, $transactionColumns] = $this->resolveSales();
            $source = $linesSource . ' ⋈ ' . $transactionsSource;

            if ($itemByErpProduct !== []) {
                [$current, $ticketsByItem] = $this->aggregate(
                    $linesSource,
                    $transactionsSource,
                    $lineColumns,
                    $transactionColumns,
                    array_keys($itemByErpProduct),
                    $from,
                    $to
                );

                // Tickets de la période, tous produits confondus : c'est le
                // dénominateur du taux de pénétration.
                $shopTickets = $this->ticketTotals($transactionsSource, $transactionColumns, $from, $to);

                if ($compare) {
                    [$previous] = $this->aggregate(
                        $linesSource,
                        $transactionsSource,
                        $lineColumns,
                        $transactionColumns,
                        array_keys($itemByErpProduct),
                        $this->shiftYear($from),
                        $this->shiftYear($to)
                    );
                }
            } else {
                $warning = 'Aucun des produits de l\'offre ne porte de référence ERP : '
                    . 'relancez la reprise du catalogue.';
            }
        } catch (Throwable $failure) {
            // Tables de caisse absentes ou illisibles : des zéros expliqués
            // valent mieux qu'une étape bloquée.
            $warning = $failure->getMessage();
        }

        // Recomposition par boutique du module. Les quantités de la caisse sont
        // décimales (produits divisibles) : l'objectif se pense en pièces, on
        // arrondit à l'entier le plus proche.
        $rows                  = [];
        $networkByItem         = [];
        $networkByItemPrevious = [];
        $networkTotal          = 0;
        $networkPrevious       = $compare ? 0 : null;

        // Le N-1 par produit alimente le graphique « par produit » : il se
        // déduit du même agrégat, sommé sur toutes les boutiques.
        if ($compare) {
            foreach ($previous as $byProduct) {
                foreach ($byProduct as $erpProductId => $quantity) {
                    $itemId = $itemByErpProduct[$erpProductId] ?? null;
                    if ($itemId !== null) {
                        $networkByItemPrevious[$itemId] =
                            ($networkByItemPrevious[$itemId] ?? 0) + (int) round((float) $quantity);
                    }
                }
            }
        }

        $networkTicketsByItem = [];
        $networkTickets       = 0;

        foreach ($shops as $shop) {
            $erpShopId  = $shop['erp_shop_id'] === null ? null : (int) $shop['erp_shop_id'];
            $quantities = [];
            $tickets    = [];
            $total      = 0;

            foreach ($itemByErpProduct as $erpProductId => $itemId) {
                $quantity = (int) round((float) ($current[$erpShopId][$erpProductId] ?? 0));
                if ($quantity !== 0) {
                    $quantities[$itemId] = $quantity;
                    $networkByItem[$itemId] = ($networkByItem[$itemId] ?? 0) + $quantity;
                }
                $total += $quantity;

                // Tickets contenant le produit. Comptés distincts par boutique,
                // ils s'additionnent sans double compte au niveau réseau : un
                // ticket appartient à une seule boutique.
                $ticketCount = (int) ($ticketsByItem[$erpShopId][$erpProductId] ?? 0);
                if ($ticketCount !== 0) {
                    $tickets[$itemId] = $ticketCount;
                    $networkTicketsByItem[$itemId] =
                        ($networkTicketsByItem[$itemId] ?? 0) + $ticketCount;
                }
            }

            $totalPrevious = null;
            if ($compare) {
                $totalPrevious = (int) round((float) array_sum($previous[$erpShopId] ?? []));
                $networkPrevious += $totalPrevious;
            }

            $shopTicketCount = (int) ($shopTickets[$erpShopId] ?? 0);

            $rows[] = [
                'shop_id'            => (int) $shop['id'],
                'shop_name'          => (string) $shop['name'],
                'quantities'         => $quantities === [] ? (object) [] : $quantities,
                'total'              => $total,
                'total_previous'     => $totalPrevious,
                'tickets'            => $shopTicketCount,
                'tickets_by_product' => $tickets === [] ? (object) [] : $tickets,
            ];

            $networkTotal   += $total;
            $networkTickets += $shopTicketCount;
        }

        return [
            'from'     => $from,
            'to'       => $to,
            'compare'  => $compare,
            'products' => $empty['products'],
            'shops'    => $rows,
            'network'  => [
                'by_product'          => $networkByItem === [] ? (object) [] : $networkByItem,
                'by_product_previous' => $compare
                    ? ($networkByItemPrevious === [] ? (object) [] : $networkByItemPrevious)
                    : null,
                'total'              => $networkTotal,
                'total_previous'     => $networkPrevious,
                'tickets'            => $networkTickets,
                'tickets_by_product' => $networkTicketsByItem === []
                    ? (object) []
                    : $networkTicketsByItem,
            ],
            'source'   => $source,
            'warning'  => $warning,
        ];
    }

    /**
     * Quantités et tickets par boutique ERP puis par produit ERP, `[from, to]`.
     *
     * Deux mesures d'un même passage en caisse : combien de pièces sont
     * parties, et dans combien de tickets distincts — le second sert au taux
     * de pénétration, qu'un total de pièces ne dit pas (dix bûches peuvent
     * tenir dans un seul ticket).
     *
     * @param  list<int> $erpProductIds
     * @return array{0:array<int, array<int, float>>, 1:array<int, array<int, int>>}
     */
    private function aggregate(
        string $linesSource,
        string $transactionsSource,
        array $lineColumns,
        array $transactionColumns,
        array $erpProductIds,
        string $from,
        string $to,
    ): array {
        [$inSql, $bindings] = Database::inClause($erpProductIds, 'product');

        // Borne haute exclusive au lendemain : la journée de fin est comprise
        // entière, sans dépendre du type exact de la colonne d'horodatage.
        $bindings['date_from'] = $from . ' 00:00:00';
        $bindings['date_to']   = (new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d') . ' 00:00:00';

        $statement = Database::connection()->prepare(sprintf(
            'SELECT t.`%s` AS shop, l.`%s` AS product,
                    SUM(l.`%s`) AS quantity, COUNT(DISTINCT l.`%s`) AS tickets
               FROM %s l
               JOIN %s t ON t.`%s` = l.`%s`
              WHERE l.`%s` IN (%s)
                AND t.`%s` >= :date_from
                AND t.`%s` <  :date_to
              GROUP BY t.`%s`, l.`%s`',
            $transactionColumns['shop'],
            $lineColumns['product'],
            $lineColumns['quantity'],
            $lineColumns['transaction'],
            $linesSource,
            $transactionsSource,
            $transactionColumns['id'],
            $lineColumns['transaction'],
            $lineColumns['product'],
            $inSql,
            $transactionColumns['date'],
            $transactionColumns['date'],
            $transactionColumns['shop'],
            $lineColumns['product']
        ));
        $statement->execute($bindings);

        $quantities = [];
        $tickets    = [];
        foreach ($statement->fetchAll() as $row) {
            $quantities[(int) $row['shop']][(int) $row['product']] = (float) $row['quantity'];
            $tickets[(int) $row['shop']][(int) $row['product']]    = (int) $row['tickets'];
        }

        return [$quantities, $tickets];
    }

    /**
     * Tickets d'une boutique sur la période, tous produits confondus.
     *
     * Dénominateur du taux de pénétration : sans lui, « 1 653 cougnous » ne
     * dit pas si la boutique a servi deux cents clients ou dix mille.
     *
     * @param  array<string, string> $transactionColumns
     * @return array<int, int>
     */
    private function ticketTotals(
        string $transactionsSource,
        array $transactionColumns,
        string $from,
        string $to,
    ): array {
        $statement = Database::connection()->prepare(sprintf(
            'SELECT t.`%s` AS shop, COUNT(*) AS tickets
               FROM %s t
              WHERE t.`%s` >= :date_from
                AND t.`%s` <  :date_to
              GROUP BY t.`%s`',
            $transactionColumns['shop'],
            $transactionsSource,
            $transactionColumns['date'],
            $transactionColumns['date'],
            $transactionColumns['shop']
        ));
        $statement->execute([
            'date_from' => $from . ' 00:00:00',
            'date_to'   => (new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d') . ' 00:00:00',
        ]);

        $tickets = [];
        foreach ($statement->fetchAll() as $row) {
            $tickets[(int) $row['shop']] = (int) $row['tickets'];
        }

        return $tickets;
    }

    /** Même plage un an plus tôt — mêmes jours, décalés de −1 an. */
    private function shiftYear(string $date): string
    {
        return (new DateTimeImmutable($date))->modify('-1 year')->format('Y-m-d');
    }

    /**
     * Tables et colonnes de la caisse, résolues et jamais supposées.
     *
     * @return array{0:string, 1:string, 2:array<string,string>, 3:array<string,string>}
     */
    private function resolveSales(): array
    {
        [$linesSchema, $linesTable] = $this->source(
            'MAR_ERP_TRANSACTION_LINES_TABLE',
            'transaction_product'
        );
        [$transactionsSchema, $transactionsTable] = $this->source(
            'MAR_ERP_TRANSACTIONS_TABLE',
            'transaction'
        );

        $lineColumns        = $this->resolve($linesSchema, $linesTable, self::LINE_COLUMNS);
        $transactionColumns = $this->resolve($transactionsSchema, $transactionsTable, self::TRANSACTION_COLUMNS);

        return [
            sprintf('`%s`.`%s`', $linesSchema, $linesTable),
            sprintf('`%s`.`%s`', $transactionsSchema, $transactionsTable),
            $lineColumns,
            $transactionColumns,
        ];
    }

    /**
     * Source configurable, sous la forme `table` ou `schema.table`.
     *
     * @return array{0:string, 1:string}
     */
    private function source(string $envKey, string $default): array
    {
        $configured = trim((string) (Env::get($envKey, '') ?: ''));
        $name       = $configured === '' ? $default : $configured;

        if (str_contains($name, '.')) {
            [$schema, $table] = explode('.', $name, 2);

            return [$schema, $table];
        }

        $schema = (string) Database::connection()->query('SELECT DATABASE()')->fetchColumn();

        return [$schema, $name];
    }

    /**
     * Colonnes réelles d'une table, la première candidate trouvée par notion.
     *
     * @param  array<string, list<string>> $candidates
     * @return array<string, string>
     */
    private function resolve(string $schema, string $table, array $candidates): array
    {
        $statement = Database::connection()->prepare(
            'SELECT column_name FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table'
        );
        $statement->execute(['schema' => $schema, 'table' => $table]);
        $present = array_map('strtolower', $statement->fetchAll(PDO::FETCH_COLUMN));

        if ($present === []) {
            throw new RuntimeException(sprintf(
                'Aucune table de ventes `%s`.`%s` : l\'historique restera à zéro. '
                . 'Renseignez %s si la caisse écrit ailleurs.',
                $schema,
                $table,
                $table === 'transaction' ? 'MAR_ERP_TRANSACTIONS_TABLE' : 'MAR_ERP_TRANSACTION_LINES_TABLE'
            ));
        }

        $resolved = [];
        foreach ($candidates as $notion => $names) {
            foreach ($names as $name) {
                if (in_array(strtolower($name), $present, true)) {
                    $resolved[$notion] = $name;
                    break;
                }
            }

            if (!isset($resolved[$notion])) {
                throw new RuntimeException(sprintf(
                    'Colonne « %s » introuvable dans `%s`.`%s` (candidates : %s).',
                    $notion,
                    $schema,
                    $table,
                    implode(', ', $names)
                ));
            }
        }

        return $resolved;
    }
}
