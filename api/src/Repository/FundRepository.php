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

        // Colonnes préfixées : la vue est désormais jointe à sa table, et
        // `shop_id` existe des deux côtés — MySQL refuse alors la condition.
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'v.shop_id');
        $where                 = [sprintf('(v.shop_id IS NULL OR %s)', $scopeSql)];

        // Le fonds marketing se rend des comptes au réseau qui l'alimente : ce
        // qui l'alimente est donc lisible. Une écriture réservée à la marque ne
        // l'est pas — le solde d'un franchisé n'est pas l'affaire de son
        // voisin.
        if (Scope::shopIds($auth) !== null) {
            $where[] = 'm.is_public = 1';
        }

        if (!empty($filters['from'])) {
            $where[]          = 'v.movement_date >= :from';
            $bindings['from'] = $filters['from'];
        }

        if (!empty($filters['to'])) {
            $where[]        = 'v.movement_date <= :to';
            $bindings['to'] = $filters['to'];
        }

        $periodColumn = match ($granularity) {
            'quarter' => 'v.period_quarter',
            'year'    => 'v.period_year',
            default   => 'v.period_month',
        };

        $statement = Database::connection()->prepare(sprintf(
            // La période vient de la table et non de la vue : les fichiers de
            // vues sont rejoués à chaque migration, et une définition mise à
            // jour ailleurs qu'en un seul endroit se fait écraser au passage
            // suivant. La jointure porte sur la clé primaire.
            'SELECT %s AS period_key, v.id, v.movement_date,
                    m.period_from, m.period_to, m.lever_id, m.recurrence_id,
                    m.is_public,
                    v.direction, v.label, v.amount, v.signed_amount,
                    v.source, v.supplier_name, v.document_ref, v.shop_id, v.shop_name,
                    v.campaign_id, v.campaign_name, v.lever_code, v.lever_label,
                    v.lever_color_hex
               FROM mar_v_fund_ledger_by_period v
               JOIN mar_fund_movement m ON m.id = v.id
              WHERE %s
              ORDER BY v.movement_date, v.id',
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
            $row['lever_id']      = $row['lever_id'] !== null ? (int) $row['lever_id'] : null;
            // La ligne vient d'un frais récurrent : l'écran le dit, parce que
            // corriger une échéance et corriger l'abonnement ne sont pas la
            // même chose.
            $row['recurrence_id'] = $row['recurrence_id'] !== null ? (int) $row['recurrence_id'] : null;
            $row['is_public']     = (bool) $row['is_public'];
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
        $direction = $this->readDirection($data);
        $amount    = $this->readAmount($data);
        $date      = $this->readDate($data['movement_date'] ?? '', 'de mouvement');
        $label     = $this->readLabel($data);
        $periode   = $this->readPeriod($data);

        $this->assertLinksExist($data);

        $connection = Database::connection();
        $statement  = $connection->prepare(
            'INSERT INTO mar_fund_movement
                (direction, shop_id, campaign_id, lever_id, movement_date,
                 period_from, period_to, label, amount, source, is_public,
                 supplier_name, document_ref, created_by)
             VALUES
                (:direction, :shop_id, :campaign_id, :lever_id, :movement_date,
                 :period_from, :period_to, :label, :amount, :source, :is_public,
                 :supplier_name, :document_ref, :created_by)'
        );

        $statement->execute([
            'is_public'     => $this->readVisibility($data),
            'direction'     => $direction,
            'shop_id'       => $data['shop_id'] ?: null,
            'campaign_id'   => $data['campaign_id'] ?: null,
            'lever_id'      => $data['lever_id'] ?: null,
            'movement_date' => $date,
            'period_from'   => $periode['period_from'] ?? null,
            'period_to'     => $periode['period_to'] ?? null,
            'label'         => $label,
            'amount'        => (float) $amount,
            'source'        => $data['source'] ?: 'AUTRE',
            'supplier_name' => $data['supplier_name'] ?: null,
            'document_ref'  => $data['document_ref'] ?: null,
            'created_by'    => $auth->userId,
        ]);

        return (int) $connection->lastInsertId();
    }

    /**
     * Correction d'une écriture existante.
     *
     * Une ligne du grand livre se corrige, elle ne se re-saisit pas : effacer
     * puis ressaisir change l'identifiant, et tout ce qui pointait dessus — un
     * coût de ROI, une échéance récurrente — perdrait son ancrage. Les mêmes
     * contrôles qu'à la création s'appliquent, pour la même raison : ces lignes
     * font le solde.
     *
     * Le rattachement à un frais récurrent survit à la correction : une facture
     * d'agence arrive rarement à l'euro près sur douze mois, et corriger mars ne
     * doit pas détacher mars de son abonnement.
     *
     * @param array<string,mixed> $data
     */
    public function updateMovement(AuthContext $auth, int $id, array $data): bool
    {
        $connection = Database::connection();

        $lecture = $connection->prepare('SELECT shop_id FROM mar_fund_movement WHERE id = :id');
        $lecture->execute(['id' => $id]);
        $existant = $lecture->fetch();

        if ($existant === false) {
            return false;
        }

        $this->assertWritable($auth, $existant['shop_id'] === null ? null : (int) $existant['shop_id']);

        $direction = $this->readDirection($data);
        $amount    = $this->readAmount($data);
        $date      = $this->readDate($data['movement_date'] ?? '', 'de mouvement');
        $label     = $this->readLabel($data);
        $periode   = $this->readPeriod($data);

        $this->assertLinksExist($data);

        $statement = $connection->prepare(
            'UPDATE mar_fund_movement
                SET direction = :direction, shop_id = :shop_id, campaign_id = :campaign_id,
                    lever_id = :lever_id, movement_date = :movement_date,
                    period_from = :period_from, period_to = :period_to,
                    label = :label, amount = :amount, source = :source,
                    is_public = :is_public,
                    supplier_name = :supplier_name, document_ref = :document_ref
              WHERE id = :id'
        );

        $statement->execute([
            'id'            => $id,
            'direction'     => $direction,
            'shop_id'       => $data['shop_id'] ?: null,
            'campaign_id'   => $data['campaign_id'] ?: null,
            'lever_id'      => $data['lever_id'] ?: null,
            'movement_date' => $date,
            'period_from'   => $periode['period_from'] ?? null,
            'period_to'     => $periode['period_to'] ?? null,
            'label'         => $label,
            'amount'        => $amount,
            'source'        => $data['source'] ?: 'AUTRE',
            'is_public'     => $this->readVisibility($data),
            'supplier_name' => $data['supplier_name'] ?: null,
            'document_ref'  => $data['document_ref'] ?: null,
        ]);

        return true;
    }

    /** Suppression d'une écriture. Rien ne la remplace : le solde bouge. */
    public function deleteMovement(AuthContext $auth, int $id): bool
    {
        $connection = Database::connection();

        $lecture = $connection->prepare('SELECT shop_id FROM mar_fund_movement WHERE id = :id');
        $lecture->execute(['id' => $id]);
        $existant = $lecture->fetch();

        if ($existant === false) {
            return false;
        }

        $this->assertWritable($auth, $existant['shop_id'] === null ? null : (int) $existant['shop_id']);

        $suppression = $connection->prepare('DELETE FROM mar_fund_movement WHERE id = :id');
        $suppression->execute(['id' => $id]);

        return $suppression->rowCount() > 0;
    }

    // -------------------------------------------------------------------------
    // Frais récurrents
    // -------------------------------------------------------------------------

    /** Pas de rythme libre : ces trois-là couvrent ce que le fonds paie. */
    private const FREQUENCIES = ['month' => 1, 'quarter' => 3, 'year' => 12];

    /**
     * Garde-fou sur le nombre d'échéances. Une saisie au jour près sur dix ans
     * n'est pas un frais récurrent, c'est une faute de frappe sur l'année de
     * fin — et elle écrirait des milliers de lignes avant qu'on s'en aperçoive.
     */
    private const MAX_OCCURRENCES = 240;

    /**
     * Les frais récurrents visibles, avec ce qu'ils ont déjà engendré.
     *
     * @return list<array<string,mixed>>
     */
    public function recurrences(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'r.shop_id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT r.id, r.direction, r.frequency, r.label, r.amount,
                    r.starts_on, r.ends_on, r.shop_id, s.name AS shop_name,
                    r.campaign_id, c.name AS campaign_name,
                    r.lever_id, l.label AS lever_label, l.color_hex AS lever_color_hex,
                    r.source, r.supplier_name, r.document_ref,
                    COUNT(m.id)                    AS occurrences,
                    COALESCE(SUM(m.amount), 0)     AS total_amount
               FROM mar_fund_recurrence r
               LEFT JOIN mar_shop     s ON s.id = r.shop_id
               LEFT JOIN mar_campaign c ON c.id = r.campaign_id
               LEFT JOIN mar_lever    l ON l.id = r.lever_id
               LEFT JOIN mar_fund_movement m ON m.recurrence_id = r.id
              WHERE (r.shop_id IS NULL OR %s)
              GROUP BY r.id
              ORDER BY r.starts_on DESC, r.id DESC',
            $scopeSql
        ));
        $statement->execute($bindings);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id']           = (int) $row['id'];
            $row['amount']       = (float) $row['amount'];
            $row['total_amount'] = (float) $row['total_amount'];
            $row['occurrences']  = (int) $row['occurrences'];
            $row['shop_id']      = $row['shop_id'] !== null ? (int) $row['shop_id'] : null;
            $row['campaign_id']  = $row['campaign_id'] !== null ? (int) $row['campaign_id'] : null;
            $row['lever_id']     = $row['lever_id'] !== null ? (int) $row['lever_id'] : null;
        }

        return $rows;
    }

    /**
     * Enregistre un frais récurrent et écrit ses échéances.
     *
     * Les échéances sont de vraies lignes du grand livre, écrites une fois pour
     * toutes plutôt que calculées à la lecture : le solde d'avril doit valoir la
     * même chose qu'on l'ouvre en mai ou dans deux ans, et une ligne qu'on ne
     * peut pas corriger n'est pas une écriture comptable.
     *
     * Tout part dans une transaction — un abonnement à moitié posé laisserait un
     * modèle sans échéances, ou des échéances qu'aucun écran ne rattache.
     *
     * @param  array<string,mixed> $data
     * @return array{id:int, occurrences:int, total_amount:float}
     */
    public function addRecurrence(AuthContext $auth, array $data): array
    {
        $direction = $this->readDirection($data);
        $amount    = $this->readAmount($data);
        $label     = $this->readLabel($data);

        $frequency = (string) ($data['frequency'] ?? '');
        if (!isset(self::FREQUENCIES[$frequency])) {
            throw new RuntimeException('Rythme inconnu : attendu month, quarter ou year.');
        }

        $debut = $this->readDate($data['starts_on'] ?? '', 'de début');
        $fin   = $this->readDate($data['ends_on'] ?? '', 'de fin');

        if ($fin < $debut) {
            throw new RuntimeException('La fin du frais récurrent précède son début.');
        }

        $this->assertLinksExist($data);

        $echeances = $this->schedule($debut, $fin, self::FREQUENCIES[$frequency]);
        if ($echeances === []) {
            throw new RuntimeException('Cette période ne contient aucune échéance.');
        }

        if (count($echeances) > self::MAX_OCCURRENCES) {
            throw new RuntimeException(sprintf(
                'Ce rythme donnerait %d échéances (maximum %d) : vérifiez la date de fin.',
                count($echeances),
                self::MAX_OCCURRENCES
            ));
        }

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $modele = $connection->prepare(
                'INSERT INTO mar_fund_recurrence
                    (direction, frequency, label, amount, starts_on, ends_on,
                     shop_id, campaign_id, lever_id, source, supplier_name,
                     document_ref, created_by)
                 VALUES
                    (:direction, :frequency, :label, :amount, :starts_on, :ends_on,
                     :shop_id, :campaign_id, :lever_id, :source, :supplier_name,
                     :document_ref, :created_by)'
            );

            $modele->execute([
                'direction'     => $direction,
                'frequency'     => $frequency,
                'label'         => $label,
                'amount'        => $amount,
                'starts_on'     => $debut,
                'ends_on'       => $fin,
                'shop_id'       => $data['shop_id'] ?: null,
                'campaign_id'   => $data['campaign_id'] ?: null,
                'lever_id'      => $data['lever_id'] ?: null,
                'source'        => $data['source'] ?: 'AUTRE',
                'supplier_name' => $data['supplier_name'] ?: null,
                'document_ref'  => $data['document_ref'] ?: null,
                'created_by'    => $auth->userId,
            ]);

            $recurrenceId = (int) $connection->lastInsertId();

            $ecriture = $connection->prepare(
                'INSERT INTO mar_fund_movement
                    (direction, shop_id, campaign_id, lever_id, recurrence_id,
                     movement_date, period_from, period_to, label, amount,
                     source, supplier_name, document_ref, created_by)
                 VALUES
                    (:direction, :shop_id, :campaign_id, :lever_id, :recurrence_id,
                     :movement_date, :period_from, :period_to, :label, :amount,
                     :source, :supplier_name, :document_ref, :created_by)'
            );

            foreach ($echeances as $echeance) {
                $ecriture->execute([
                    'direction'     => $direction,
                    'shop_id'       => $data['shop_id'] ?: null,
                    'campaign_id'   => $data['campaign_id'] ?: null,
                    'lever_id'      => $data['lever_id'] ?: null,
                    'recurrence_id' => $recurrenceId,
                    'movement_date' => $echeance['from'],
                    'period_from'   => $echeance['from'],
                    'period_to'     => $echeance['to'],
                    'label'         => $label,
                    'amount'        => $amount,
                    'source'        => $data['source'] ?: 'AUTRE',
                    'supplier_name' => $data['supplier_name'] ?: null,
                    'document_ref'  => $data['document_ref'] ?: null,
                    'created_by'    => $auth->userId,
                ]);
            }

            $connection->commit();
        } catch (\Throwable $echec) {
            $connection->rollBack();

            throw $echec;
        }

        return [
            'id'           => $recurrenceId,
            'occurrences'  => count($echeances),
            'total_amount' => round($amount * count($echeances), 2),
        ];
    }

    /**
     * Supprime un frais récurrent et les échéances qu'il a écrites.
     *
     * La cascade est portée par la clé étrangère : un abonnement résilié dont
     * les douze lignes resteraient au grand livre continuerait de peser sur le
     * solde, et il faudrait les retrouver une à une. L'écran annonce le compte
     * avant de le faire.
     */
    public function deleteRecurrence(AuthContext $auth, int $id): bool
    {
        $connection = Database::connection();

        $lecture = $connection->prepare('SELECT shop_id FROM mar_fund_recurrence WHERE id = :id');
        $lecture->execute(['id' => $id]);
        $existant = $lecture->fetch();

        if ($existant === false) {
            return false;
        }

        $this->assertWritable($auth, $existant['shop_id'] === null ? null : (int) $existant['shop_id']);

        $suppression = $connection->prepare('DELETE FROM mar_fund_recurrence WHERE id = :id');
        $suppression->execute(['id' => $id]);

        return $suppression->rowCount() > 0;
    }

    /**
     * Les échéances d'un frais récurrent, bornes comprises.
     *
     * Chaque échéance est calculée depuis le début et non depuis la précédente :
     * en repartant de la dernière, un 31 janvier deviendrait le 28 février puis
     * le 28 mars, et l'abonnement glisserait d'un jour à chaque mois court. Le
     * quantième est ramené au dernier jour du mois quand il n'existe pas.
     *
     * @return list<array{from:string, to:string}>
     */
    private function schedule(string $debut, string $fin, int $pas): array
    {
        $base       = new \DateTimeImmutable($debut);
        $derniere   = new \DateTimeImmutable($fin);
        $echeances  = [];

        for ($rang = 0; $rang <= self::MAX_OCCURRENCES; $rang++) {
            $ouverture = $this->plusMois($base, $rang * $pas);
            if ($ouverture > $derniere) {
                break;
            }

            $suivante = $this->plusMois($base, ($rang + 1) * $pas)->modify('-1 day');

            $echeances[] = [
                'from' => $ouverture->format('Y-m-d'),
                // La dernière échéance s'arrête à la fin déclarée, pas au terme
                // théorique : « jusqu'au 30 juin » ne doit pas facturer juillet.
                'to'   => ($suivante > $derniere ? $derniere : $suivante)->format('Y-m-d'),
            ];
        }

        return $echeances;
    }

    /** Ajout de mois sans débordement : le 31 mars + 1 mois donne le 30 avril. */
    private function plusMois(\DateTimeImmutable $base, int $mois): \DateTimeImmutable
    {
        $rang    = ((int) $base->format('Y')) * 12 + ((int) $base->format('n')) - 1 + $mois;
        $annee   = intdiv($rang, 12);
        $moisCible = $rang % 12 + 1;

        $premier = new \DateTimeImmutable(sprintf('%04d-%02d-01', $annee, $moisCible));
        $quantieme = min((int) $base->format('j'), (int) $premier->format('t'));

        return $premier->setDate($annee, $moisCible, $quantieme);
    }

    // -------------------------------------------------------------------------
    // Contrôles partagés entre l'écriture isolée et le frais récurrent
    // -------------------------------------------------------------------------

    /**
     * Un sens inconnu était autrefois ramené à « OUT » : une faute de frappe sur
     * « IN » retirait donc l'argent au lieu de l'ajouter.
     *
     * @param array<string,mixed> $data
     */
    private function readDirection(array $data): string
    {
        $direction = $data['direction'] ?? null;
        if (!in_array($direction, ['IN', 'OUT'], true)) {
            throw new RuntimeException('Sens du mouvement inconnu : attendu IN ou OUT.');
        }

        return $direction;
    }

    /**
     * Le montant ne porte jamais de signe : la vue le déduit du sens, et un
     * « −100 € » en sortie créditerait le fonds.
     *
     * @param array<string,mixed> $data
     */
    private function readAmount(array $data): float
    {
        $amount = $data['amount'] ?? null;
        if (!is_numeric($amount) || (float) $amount <= 0) {
            throw new RuntimeException(
                'Le montant doit être strictement positif : c\'est le sens qui porte le signe.'
            );
        }

        return (float) $amount;
    }

    /**
     * Visibilité de l'écriture, publique par défaut.
     *
     * Le défaut n'est pas neutre : le fonds marketing se rend des comptes au
     * réseau qui l'alimente, et une ligne muette par accident vaut moins qu'une
     * ligne visible par accident. Une écriture qui demande le silence le demande
     * donc explicitement, à la saisie.
     *
     * @param array<string,mixed> $data
     */
    private function readVisibility(array $data): int
    {
        if (!array_key_exists('is_public', $data) || $data['is_public'] === null) {
            return 1;
        }

        return filter_var($data['is_public'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
    }

    /** @param array<string,mixed> $data */
    private function readLabel(array $data): string
    {
        $label = trim((string) ($data['label'] ?? ''));
        if ($label === '') {
            throw new RuntimeException('Le libellé du mouvement est obligatoire.');
        }

        return $label;
    }

    private function readDate(mixed $valeur, string $quoi): string
    {
        $date = (string) $valeur;
        $lue  = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        if ($lue === false || $lue->format('Y-m-d') !== $date) {
            throw new RuntimeException(sprintf(
                'Date %s invalide : format attendu AAAA-MM-JJ.',
                $quoi
            ));
        }

        return $date;
    }

    /**
     * Période couverte : les deux bornes, ou aucune. Une période ouverte d'un
     * côté ne se totalise pas, et « du 1er avril à jamais » donnerait un grand
     * livre qu'aucun trimestre ne referme.
     *
     * @param  array<string,mixed> $data
     * @return array{period_from?:string, period_to?:string}
     */
    private function readPeriod(array $data): array
    {
        $periode = [];
        foreach (['period_from', 'period_to'] as $borne) {
            $valeur = trim((string) ($data[$borne] ?? ''));
            if ($valeur === '') {
                continue;
            }

            $periode[$borne] = $this->readDate($valeur, sprintf('de période (%s)', $borne));
        }

        if (count($periode) === 1) {
            throw new RuntimeException(
                'Période incomplète : donnez le début et la fin, ou aucun des deux.'
            );
        }

        if ($periode !== [] && $periode['period_to'] < $periode['period_from']) {
            throw new RuntimeException('La fin de période précède son début.');
        }

        return $periode;
    }

    /**
     * Les rattachements sont vérifiés ici plutôt que laissés aux clés
     * étrangères : une violation de contrainte remonte en erreur interne, là où
     * l'utilisateur a seulement désigné une campagne supprimée.
     *
     * @param array<string,mixed> $data
     */
    private function assertLinksExist(array $data): void
    {
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
    }

    /**
     * Droit d'écriture sur une ligne existante.
     *
     * Une ligne du fonds commun (sans boutique) est lisible par tout le réseau —
     * c'est le pot commun — mais elle ne se corrige qu'au niveau de la marque :
     * un franchisé qui rectifierait l'écriture d'un autre déplacerait un solde
     * qui n'est pas le sien.
     */
    private function assertWritable(AuthContext $auth, ?int $shopId): void
    {
        $autorisee = $shopId === null
            ? Scope::shopIds($auth) === null
            : Scope::allowsShop($auth, $shopId);

        if (!$autorisee) {
            throw new RuntimeException('Cette écriture est hors de votre périmètre.');
        }
    }
}
