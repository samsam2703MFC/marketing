<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use RuntimeException;

/** Fonds marketing : grand livre, synthèse par levier, ROI. */
final class FundRepository
{
    private const GRANULARITIES = ['month', 'quarter', 'year'];

    /**
     * Grand livre groupé par période.
     *
     * Une seule lecture de `mar_v_fund_ledger_by_period`, puis le regroupement en
     * PHP : entrées d'abord avec leur sous-total, sorties ensuite avec le leur, et
     * un solde courant qui cumule à travers les deux blocs. Le solde est
     * séquentiel par nature — le calculer en SQL imposerait une fonction de
     * fenêtrage absente de MySQL 5.7, pour un gain nul sur ces volumes.
     *
     * @param  array{granularity?:string, from?:?string, to?:?string} $filters
     * @return array{periods:list<array<string,mixed>>, granularity:string, closing_balance:float}
     */
    public function ledger(AuthContext $auth, array $filters = []): array
    {
        $granularity = in_array($filters['granularity'] ?? 'month', self::GRANULARITIES, true)
            ? $filters['granularity']
            : 'month';

        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'shop_id');
        $where                 = [sprintf('(shop_id IS NULL OR %s)', $scopeSql)];

        if (!empty($filters['from'])) {
            $where[]          = 'movement_date >= :from';
            $bindings['from'] = $filters['from'];
        }

        if (!empty($filters['to'])) {
            $where[]        = 'movement_date <= :to';
            $bindings['to'] = $filters['to'];
        }

        $periodColumn = match ($granularity) {
            'quarter' => 'period_quarter',
            'year'    => 'period_year',
            default   => 'period_month',
        };

        $statement = Database::connection()->prepare(sprintf(
            'SELECT %s AS period_key, id, movement_date, direction, label, amount, signed_amount,
                    source, supplier_name, document_ref, shop_id, shop_name,
                    campaign_id, campaign_name, lever_code, lever_label, lever_color_hex
               FROM mar_v_fund_ledger_by_period
              WHERE %s
              ORDER BY movement_date, id',
            $periodColumn,
            implode(' AND ', $where)
        ));
        $statement->execute($bindings);

        $grouped = [];
        foreach ($statement->fetchAll() as $row) {
            $row['amount']        = (float) $row['amount'];
            $row['signed_amount'] = (float) $row['signed_amount'];
            $row['id']            = (int) $row['id'];
            $row['shop_id']       = $row['shop_id'] !== null ? (int) $row['shop_id'] : null;
            $row['campaign_id']   = $row['campaign_id'] !== null ? (int) $row['campaign_id'] : null;
            // Le badge ⛓ de la maquette : la ligne est rattachée à une campagne.
            $row['is_linked']     = $row['campaign_id'] !== null;

            $grouped[(string) $row['period_key']][] = $row;
        }

        $balance = 0.0;
        $periods = [];

        foreach ($grouped as $periodKey => $rows) {
            $entries = array_values(array_filter($rows, static fn ($r) => $r['direction'] === 'IN'));
            $exits   = array_values(array_filter($rows, static fn ($r) => $r['direction'] === 'OUT'));

            $entriesTotal = array_sum(array_column($entries, 'amount'));
            $exitsTotal   = array_sum(array_column($exits, 'amount'));

            $openingBalance = $balance;
            $balance       += $entriesTotal - $exitsTotal;

            $periods[] = [
                'period_key'      => $periodKey,
                'entries'         => $entries,
                'entries_total'   => round($entriesTotal, 2),
                'exits'           => $exits,
                'exits_total'     => round($exitsTotal, 2),
                'opening_balance' => round($openingBalance, 2),
                'closing_balance' => round($balance, 2),
            ];
        }

        return [
            'granularity'     => $granularity,
            'periods'         => $periods,
            'closing_balance' => round($balance, 2),
        ];
    }

    /**
     * Synthèse par levier : dépense, ventes générées, ROI, pénétration sur le CA
     * réseau. La pénétration se calcule ici car elle rapporte le levier au CA
     * total, qui n'est pas dans la vue.
     *
     * @return list<array<string,mixed>>
     */
    public function leverSummary(): array
    {
        $rows = Database::connection()
            ->query('SELECT * FROM mar_v_lever_performance ORDER BY lever_code')
            ->fetchAll();

        $networkRevenue = (float) Database::connection()
            ->query('SELECT COALESCE(SUM(revenue_amount), 0) FROM mar_shop_revenue')
            ->fetchColumn();

        foreach ($rows as &$row) {
            $row['spent_amount']  = (float) $row['spent_amount'];
            $row['target_value']  = (float) $row['target_value'];
            $row['actual_value']  = (float) $row['actual_value'];
            $row['roi_value']     = $row['roi_value'] !== null ? (float) $row['roi_value'] : null;
            $row['lever_id']      = (int) $row['lever_id'];
            $row['penetration_pct'] = $networkRevenue > 0
                ? round($row['actual_value'] / $networkRevenue * 100, 2)
                : null;
        }

        return $rows;
    }

    /**
     * Coût pour +1 000 € de CA par trimestre, avec le sens de variation.
     * ▼ = coût en baisse, donc campagne plus efficace : c'est l'inverse de la
     * lecture habituelle d'une flèche descendante, d'où le champ explicite.
     *
     * @return list<array<string,mixed>>
     */
    public function roiQuarterly(): array
    {
        $rows = Database::connection()
            ->query('SELECT * FROM mar_v_roi_quarterly ORDER BY period_year, period_quarter')
            ->fetchAll();

        $previous = null;
        foreach ($rows as &$row) {
            $row['total_cost_amount']     = (float) $row['total_cost_amount'];
            $row['generated_revenue']     = (float) $row['generated_revenue'];
            $row['cost_per_1000_revenue'] = $row['cost_per_1000_revenue'] !== null
                ? (float) $row['cost_per_1000_revenue']
                : null;

            $current = $row['cost_per_1000_revenue'];
            if ($previous !== null && $current !== null) {
                $row['trend']            = $current < $previous ? 'down' : ($current > $previous ? 'up' : 'flat');
                $row['is_improvement']   = $current < $previous;
            } else {
                $row['trend']          = null;
                $row['is_improvement'] = null;
            }

            $previous = $current ?? $previous;
        }

        return $rows;
    }

    /** @return list<array<string,mixed>> */
    public function roiCosts(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT id, label, source_label, amount, cost_kind
               FROM mar_roi_cost WHERE campaign_id = :id ORDER BY cost_kind, id'
        );
        $statement->execute(['id' => $campaignId]);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id']     = (int) $row['id'];
            $row['amount'] = (float) $row['amount'];
        }

        return $rows;
    }

    /** @param array<string,mixed> $data */
    /**
     * Écriture d'un mouvement de fonds.
     *
     * Le contrôle est plus strict qu'ailleurs parce que ces lignes forment le
     * solde du fonds, et que le solde alimente à son tour le ROI. Deux
     * tolérances de l'implémentation précédente pouvaient le fausser sans que
     * rien ne le signale :
     *
     * — un sens inconnu était ramené à « OUT ». Une faute de frappe sur
     *   « IN » retirait donc l'argent au lieu de l'ajouter.
     * — un montant négatif passait tel quel. Une sortie de −100 € créditait le
     *   fonds, la vue calculant le signe à partir du sens et non du montant.
     *
     * @param array<string,mixed> $data
     */
    public function addMovement(AuthContext $auth, array $data): int
    {
        $direction = $data['direction'] ?? null;
        if (!in_array($direction, ['IN', 'OUT'], true)) {
            throw new RuntimeException('Sens du mouvement inconnu : attendu IN ou OUT.');
        }

        $amount = $data['amount'] ?? null;
        if (!is_numeric($amount) || (float) $amount <= 0) {
            throw new RuntimeException(
                'Le montant doit être strictement positif : c\'est le sens qui porte le signe.'
            );
        }

        $date = (string) ($data['movement_date'] ?? '');
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($parsed === false || $parsed->format('Y-m-d') !== $date) {
            throw new RuntimeException('Date de mouvement invalide : format attendu AAAA-MM-JJ.');
        }

        $label = trim((string) ($data['label'] ?? ''));
        if ($label === '') {
            throw new RuntimeException('Le libellé du mouvement est obligatoire.');
        }

        // Les rattachements sont vérifiés ici plutôt que laissés aux clés
        // étrangères : une violation de contrainte remonte en erreur interne,
        // là où l'utilisateur a seulement désigné une campagne supprimée.
        $connection = Database::connection();

        foreach ([
            'campaign_id' => ['mar_campaign', 'Campagne introuvable.'],
            'lever_id'    => ['mar_lever', 'Levier introuvable.'],
            'shop_id'     => ['mar_shop', 'Boutique introuvable.'],
        ] as $field => [$table, $message]) {
            if (empty($data[$field])) {
                continue;
            }

            $exists = $connection->prepare(sprintf('SELECT 1 FROM %s WHERE id = :id', $table));
            $exists->execute(['id' => (int) $data[$field]]);

            if ($exists->fetchColumn() === false) {
                throw new RuntimeException($message);
            }
        }

        $statement = $connection->prepare(
            'INSERT INTO mar_fund_movement
                (direction, shop_id, campaign_id, lever_id, movement_date, label, amount, source,
                 supplier_name, document_ref, created_by)
             VALUES
                (:direction, :shop_id, :campaign_id, :lever_id, :movement_date, :label, :amount, :source,
                 :supplier_name, :document_ref, :created_by)'
        );

        $statement->execute([
            'direction'     => $direction,
            'shop_id'       => $data['shop_id'] ?: null,
            'campaign_id'   => $data['campaign_id'] ?: null,
            'lever_id'      => $data['lever_id'] ?: null,
            'movement_date' => $date,
            'label'         => $label,
            'amount'        => (float) $amount,
            'source'        => $data['source'] ?: 'AUTRE',
            'supplier_name' => $data['supplier_name'] ?: null,
            'document_ref'  => $data['document_ref'] ?: null,
            'created_by'    => $auth->userId,
        ]);

        return (int) $connection->lastInsertId();
    }
}
