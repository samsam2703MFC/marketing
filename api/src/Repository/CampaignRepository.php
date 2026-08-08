<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;

/** Campagnes : liste, fiche, calendrier, suivi en direct, écriture. */
final class CampaignRepository
{
    /**
     * Liste filtrable. Le périmètre s'applique en SQL : un franchisé ne reçoit
     * que les campagnes réseau et celles où l'une de ses boutiques participe.
     *
     * @param  array{status?:?string, scope?:?string, brand_id?:?int} $filters
     * @return list<array<string,mixed>>
     */
    public function list(AuthContext $auth, array $filters = []): array
    {
        [$scopeSql, $scopeBindings] = Scope::campaignFilter($auth);

        $where    = [$scopeSql];
        $bindings = $scopeBindings;

        if (!empty($filters['status'])) {
            $where[]            = 'c.status_code = :status';
            $bindings['status'] = $filters['status'];
        }

        if (!empty($filters['scope'])) {
            $where[]           = 'c.scope = :scope';
            $bindings['scope'] = $filters['scope'];
        }

        if (!empty($filters['brand_id'])) {
            $where[]              = 'c.brand_id = :brand_id';
            $bindings['brand_id'] = $filters['brand_id'];
        }

        $sql = sprintf(
            'SELECT
                c.id, c.name, c.scope, c.status_code, c.starts_on, c.ends_on,
                c.budget_amount, c.spent_amount, c.image_url, c.approval_status,
                c.create_crm_leads, c.parent_campaign_id,
                b.name  AS brand_name,
                t.label AS type_label,
                t.code  AS type_code,
                st.label    AS status_label,
                st.text_hex AS status_text_hex,
                st.bg_rgba  AS status_bg_rgba,
                (SELECT COUNT(*) FROM mar_campaign_shop cs WHERE cs.campaign_id = c.id) AS shops_count
             FROM mar_campaign c
             JOIN mar_brand b            ON b.id = c.brand_id
             JOIN mar_campaign_status st ON st.code = c.status_code
             LEFT JOIN mar_campaign_type t ON t.id = c.type_id
             WHERE %s
             ORDER BY c.starts_on DESC, c.id DESC',
            implode(' AND ', $where)
        );

        $statement = Database::connection()->prepare($sql);
        $statement->execute($bindings);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return array<string,mixed>|null */
    public function find(AuthContext $auth, int $id): ?array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth);
        $bindings['id']        = $id;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.*, b.name AS brand_name, t.label AS type_label,
                    st.label AS status_label, st.text_hex AS status_text_hex, st.bg_rgba AS status_bg_rgba
               FROM mar_campaign c
               JOIN mar_brand b            ON b.id = c.brand_id
               JOIN mar_campaign_status st ON st.code = c.status_code
               LEFT JOIN mar_campaign_type t ON t.id = c.type_id
              WHERE c.id = :id AND %s',
            $scopeSql
        ));
        $statement->execute($bindings);

        $row = $statement->fetch();
        if ($row === false) {
            return null;
        }

        $row = $this->castRow($row);

        $row['shops']       = $this->shops($id);
        $row['levers']      = $this->leverTargets($id);
        $row['retroplanning'] = $this->retroplanning($id);
        $row['offer']       = $this->offer($id);
        $row['sectors']     = $this->sectors($id);

        return $row;
    }

    /**
     * Frise annuelle : une barre par campagne, positionnée par mois de début et
     * étalée sur sa durée. Le calcul vit ici plutôt que dans le front, qui ne
     * doit pas connaître la règle de découpage.
     *
     * @return list<array<string,mixed>>
     */
    public function calendar(AuthContext $auth, int $year): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth);

        // Deux placeholders distincts pour la même valeur : les requêtes préparées
        // côté serveur (EMULATE_PREPARES désactivé) refusent qu'un paramètre nommé
        // soit lié à plusieurs positions.
        $bindings['year_start'] = $year;
        $bindings['year_end']   = $year;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.id, c.name, c.scope, c.status_code, c.starts_on, c.ends_on,
                    st.label AS status_label, st.text_hex AS status_text_hex, st.bg_rgba AS status_bg_rgba
               FROM mar_campaign c
               JOIN mar_campaign_status st ON st.code = c.status_code
              WHERE %s
                AND c.starts_on IS NOT NULL
                AND YEAR(c.starts_on) <= :year_start
                AND (c.ends_on IS NULL OR YEAR(c.ends_on) >= :year_end)
              ORDER BY c.starts_on',
            $scopeSql
        ));
        $statement->execute($bindings);

        $rows = [];
        foreach ($statement->fetchAll() as $row) {
            $startMonth = (int) date('n', strtotime((string) $row['starts_on']));
            $endMonth   = $row['ends_on'] !== null
                ? (int) date('n', strtotime((string) $row['ends_on']))
                : $startMonth;

            // Une campagne à cheval sur l'année se tronque aux bornes affichées.
            $startYear = (int) date('Y', strtotime((string) $row['starts_on']));
            $endYear   = $row['ends_on'] !== null ? (int) date('Y', strtotime((string) $row['ends_on'])) : $startYear;

            $start = $startYear < $year ? 1  : $startMonth;
            $end   = $endYear   > $year ? 12 : $endMonth;

            $row['start_month'] = $start;
            $row['span_months'] = max(1, $end - $start + 1);
            $rows[]             = $this->castRow($row);
        }

        return $rows;
    }

    /**
     * Suivi en direct : KPI réseau et classement des boutiques.
     *
     * @return array{kpis:list<array<string,mixed>>, shops:list<array<string,mixed>>}
     */
    public function monitor(AuthContext $auth, int $campaignId): array
    {
        if ($this->find($auth, $campaignId) === null) {
            throw new RuntimeException('Campagne hors périmètre ou introuvable.');
        }

        $connection = Database::connection();

        $kpis = $connection->prepare(
            'SELECT kpi_code, kpi_label, value, target_value, unit, measured_at, attainment_pct
               FROM mar_v_campaign_monitor
              WHERE campaign_id = :id AND shop_id IS NULL
              ORDER BY kpi_code'
        );
        $kpis->execute(['id' => $campaignId]);

        $shops = $connection->prepare(
            'SELECT shop_id, shop_name, kpi_code, value, target_value, attainment_pct
               FROM mar_v_campaign_monitor
              WHERE campaign_id = :id AND shop_id IS NOT NULL
              ORDER BY attainment_pct DESC'
        );
        $shops->execute(['id' => $campaignId]);

        return [
            'kpis'  => array_map([$this, 'castRow'], $kpis->fetchAll()),
            'shops' => array_map([$this, 'castRow'], $shops->fetchAll()),
        ];
    }

    /** @param array<string,mixed> $data */
    public function create(AuthContext $auth, array $data): int
    {
        $missing = array_values(array_diff(['brand_id', 'name'], array_keys(array_filter($data, static fn ($v) => $v !== null && $v !== ''))));
        if ($missing !== []) {
            throw new RuntimeException('Champs obligatoires manquants : ' . implode(', ', $missing));
        }

        $connection = Database::connection();
        $statement  = $connection->prepare(
            'INSERT INTO mar_campaign
                (brand_id, type_id, parent_campaign_id, name, scope, status_code,
                 starts_on, ends_on, budget_amount, owner_user_id, create_crm_leads, image_url, created_by)
             VALUES
                (:brand_id, :type_id, :parent_campaign_id, :name, :scope, :status_code,
                 :starts_on, :ends_on, :budget_amount, :owner_user_id, :create_crm_leads, :image_url, :created_by)'
        );

        $statement->execute([
            'brand_id'           => (int) $data['brand_id'],
            'type_id'            => $data['type_id'] ?? null,
            'parent_campaign_id' => $data['parent_campaign_id'] ?? null,
            'name'               => $data['name'],
            'scope'              => in_array($data['scope'] ?? 'RESEAU', ['RESEAU', 'LOCALE'], true) ? $data['scope'] ?? 'RESEAU' : 'RESEAU',
            'status_code'        => $data['status_code'] ?? 'draft',
            'starts_on'          => $data['starts_on'] ?? null,
            'ends_on'            => $data['ends_on'] ?? null,
            'budget_amount'      => $data['budget_amount'] ?? 0,
            'owner_user_id'      => $data['owner_user_id'] ?? $auth->userId,
            'create_crm_leads'   => !empty($data['create_crm_leads']) ? 1 : 0,
            'image_url'          => $data['image_url'] ?? null,
            'created_by'         => $auth->userId,
        ]);

        return (int) $connection->lastInsertId();
    }

    /**
     * Création complète, telle que l'assistant en sept étapes la produit.
     *
     * Une campagne n'est pas qu'une ligne : elle porte ses boutiques, ses
     * canaux de diffusion et ses objectifs par levier. Les écrire séparément
     * laisserait, à la première erreur, une campagne à moitié montée —
     * visible, budgétée, mais sans périmètre ni canal. D'où la transaction.
     *
     * @param  array<string,mixed> $data  Champs de campagne, plus les clés
     *                                    `shop_ids`, `channels`, `lever_targets`.
     * @throws RuntimeException si une boutique est hors périmètre.
     */
    public function createWithRelations(AuthContext $auth, array $data): int
    {
        $shopIds  = self::intList($data['shop_ids'] ?? []);
        $channels = is_array($data['channels'] ?? null) ? $data['channels'] : [];
        $targets  = is_array($data['lever_targets'] ?? null) ? $data['lever_targets'] : [];

        // Le contrôle de périmètre passe avant l'ouverture de la transaction :
        // inutile d'écrire quoi que ce soit pour l'annuler ensuite.
        foreach ($shopIds as $shopId) {
            if (!Scope::allowsShop($auth, $shopId)) {
                throw new RuntimeException('Boutique hors périmètre : ' . $shopId);
            }
        }

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $campaignId = $this->create($auth, $data);

            if ($shopIds !== []) {
                $statement = $connection->prepare(
                    'INSERT INTO mar_campaign_shop (campaign_id, shop_id, created_by)
                     VALUES (:campaign_id, :shop_id, :created_by)'
                );
                foreach ($shopIds as $shopId) {
                    $statement->execute([
                        'campaign_id' => $campaignId,
                        'shop_id'     => $shopId,
                        'created_by'  => $auth->userId,
                    ]);
                }
            }

            if ($channels !== []) {
                $statement = $connection->prepare(
                    'INSERT INTO mar_campaign_channel
                        (campaign_id, channel_id, agency_id, budget_amount, is_enabled, created_by)
                     VALUES (:campaign_id, :channel_id, :agency_id, :budget_amount, 1, :created_by)'
                );
                foreach ($channels as $channel) {
                    $channelId = (int) ($channel['channel_id'] ?? 0);
                    if ($channelId === 0) {
                        continue;
                    }

                    // `budget_amount` est NOT NULL DEFAULT 0. Activer un canal
                    // sans lui donner de budget est légitime — le montant se
                    // décide plus tard — et doit valoir zéro, pas une 500.
                    $budget = $channel['budget_amount'] ?? null;

                    $statement->execute([
                        'campaign_id'   => $campaignId,
                        'channel_id'    => $channelId,
                        'agency_id'     => isset($channel['agency_id']) && $channel['agency_id'] !== ''
                            ? (int) $channel['agency_id']
                            : null,
                        'budget_amount' => $budget === null || $budget === '' ? 0 : $budget,
                        'created_by'    => $auth->userId,
                    ]);
                }
            }

            if ($targets !== []) {
                $statement = $connection->prepare(
                    'INSERT INTO mar_campaign_lever_target
                        (campaign_id, lever_id, target_value, target_unit, created_by)
                     VALUES (:campaign_id, :lever_id, :target_value, :target_unit, :created_by)'
                );
                foreach ($targets as $target) {
                    $leverId = (int) ($target['lever_id'] ?? 0);
                    if ($leverId === 0) {
                        continue;
                    }

                    $statement->execute([
                        'campaign_id'  => $campaignId,
                        'lever_id'     => $leverId,
                        'target_value' => $target['target_value'] ?? 0,
                        'target_unit'  => $target['target_unit'] ?? null,
                        'created_by'   => $auth->userId,
                    ]);
                }
            }

            $connection->commit();

            return $campaignId;
        } catch (\Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }
    }

    /**
     * @param  mixed $values
     * @return list<int>
     */
    private static function intList(mixed $values): array
    {
        if (!is_array($values)) {
            return [];
        }

        $ints = array_map('intval', $values);

        return array_values(array_unique(array_filter($ints, static fn (int $v): bool => $v > 0)));
    }

    /** @param array<string,mixed> $data */
    public function update(AuthContext $auth, int $id, array $data): bool
    {
        if ($this->find($auth, $id) === null) {
            return false;
        }

        $columns = [
            'type_id', 'name', 'scope', 'status_code', 'starts_on', 'ends_on',
            'budget_amount', 'spent_amount', 'approval_status', 'create_crm_leads', 'image_url',
        ];

        $assignments = [];
        $bindings    = ['id' => $id];

        foreach ($columns as $column) {
            if (array_key_exists($column, $data)) {
                $assignments[]      = sprintf('%1$s = :%1$s', $column);
                $bindings[$column]  = $data[$column];
            }
        }

        if ($assignments === []) {
            return true;
        }

        $statement = Database::connection()->prepare(
            sprintf('UPDATE mar_campaign SET %s WHERE id = :id', implode(', ', $assignments))
        );

        return $statement->execute($bindings);
    }

    public function delete(AuthContext $auth, int $id): bool
    {
        if ($this->find($auth, $id) === null) {
            return false;
        }

        $statement = Database::connection()->prepare('DELETE FROM mar_campaign WHERE id = :id');

        return $statement->execute(['id' => $id]);
    }

    /** @return list<array<string,mixed>> */
    private function shops(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT cs.shop_id, s.name AS shop_name, s.city, cs.opt_in_at, cs.local_budget_amount
               FROM mar_campaign_shop cs
               JOIN mar_shop s ON s.id = cs.shop_id
              WHERE cs.campaign_id = :id
              ORDER BY s.name'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return list<array<string,mixed>> */
    private function leverTargets(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT clt.lever_id, l.code, l.label, l.color_hex,
                    clt.target_value, clt.target_unit, clt.actual_value
               FROM mar_campaign_lever_target clt
               JOIN mar_lever l ON l.id = clt.lever_id
              WHERE clt.campaign_id = :id
              ORDER BY l.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return list<array<string,mixed>> */
    private function retroplanning(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT rs.id, rs.label, rs.days_before_launch, rs.position_id,
                    p.label AS position_label, rs.assignee_user_id, rs.done_at, rs.sort_order
               FROM mar_retroplanning_step rs
               LEFT JOIN mar_position p ON p.id = rs.position_id
              WHERE rs.campaign_id = :id
              ORDER BY rs.sort_order, rs.days_before_launch DESC'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return array<string,mixed>|null */
    private function offer(int $campaignId): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT co.*, l.code AS lever_code, l.label AS lever_label, l.color_hex AS lever_color_hex,
                    v.code AS voucher_code
               FROM mar_campaign_offer co
               LEFT JOIN mar_lever l   ON l.id = co.lever_id
               LEFT JOIN mar_voucher v ON v.id = co.voucher_id
              WHERE co.campaign_id = :id
              ORDER BY co.id
              LIMIT 1'
        );
        $statement->execute(['id' => $campaignId]);

        $offer = $statement->fetch();
        if ($offer === false) {
            return null;
        }

        $items = Database::connection()->prepare(
            'SELECT label, offer_item_id, sort_order
               FROM mar_campaign_offer_item
              WHERE campaign_offer_id = :id
              ORDER BY sort_order'
        );
        $items->execute(['id' => (int) $offer['id']]);

        $offer          = $this->castRow($offer);
        $offer['items'] = $items->fetchAll();

        return $offer;
    }

    /** @return list<array<string,mixed>> */
    private function sectors(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT s.id, s.code, s.label, s.estimated_leads_count
               FROM mar_campaign_b2b_sector cbs
               JOIN mar_b2b_sector s ON s.id = cbs.sector_id
              WHERE cbs.campaign_id = :id
              ORDER BY s.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /**
     * PDO renvoie les DECIMAL en chaîne. On les convertit ici, une fois, pour que
     * le front reçoive des nombres et n'ait pas à deviner quelles colonnes parser.
     *
     * @param  array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function castRow(array $row): array
    {
        // Colonnes numériques dont le nom ne porte aucun suffixe exploitable.
        // `mar_campaign_kpi_snapshot.value` en fait partie : sans elle, un KPI
        // repartait en chaîne « 1284.00 » et s'affichait tel quel.
        static $numericColumns = ['value', 'amount', 'quantity', 'rate_pct'];

        foreach ($row as $key => $value) {
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (
                in_array($key, $numericColumns, true)
                || str_ends_with($key, '_amount')
                || str_ends_with($key, '_pct')
                || str_ends_with($key, '_value')
            ) {
                $row[$key] = (float) $value;
            } elseif (str_ends_with($key, '_id') || str_ends_with($key, '_count') || $key === 'id') {
                $row[$key] = (int) $value;
            }
        }

        if (array_key_exists('create_crm_leads', $row)) {
            $row['create_crm_leads'] = (bool) $row['create_crm_leads'];
        }

        return $row;
    }
}
