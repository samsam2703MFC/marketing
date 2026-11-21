<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Agences, prestataires et rentabilité.
 *
 * Ces écrans sont de niveau réseau : un franchisé ne choisit pas les agences du
 * groupe. Aucun filtre de périmètre ici — c'est le routeur qui décide qui y
 * accède, pas ce dépôt.
 *
 * Le référentiel s'écrit ici depuis le 21/11/2026 (AgencyController) : le cockpit,
 * qui l'écrivait en SQL avec ses quatre colonnes (adresse, site, logo, agence par
 * défaut, reprises par la migration 045), passe par ces routes.
 */
final class AgencyRepository
{
    /** Les champs que les routes d'écriture acceptent, et leur colonne. */
    public const WRITABLE = ['name' => 'name', 'email' => 'email', 'site' => 'site', 'logoUri' => 'logo_uri', 'isDefault' => 'is_default'];

    /**
     * Agences, avec le nombre d'interventions réellement enregistrées.
     *
     * `mar_agency.campaigns_count` est une colonne dénormalisée : on lui préfère
     * le compte réel, qui ne peut pas diverger. La colonne reste exposée pour
     * qu'un écart se voie plutôt que de se cacher.
     *
     * @return list<array<string,mixed>>
     */
    public function agencies(): array
    {
        $rows = Database::connection()->query(
            'SELECT a.id, a.name, a.speciality, a.avg_roi, a.hit_rate_pct,
                    a.avg_cost_amount, a.campaigns_count,
                    -- Ce que le cockpit lisait dans la table (21/11/2026) : adresse, site, logo, agence par défaut, et
                    -- les campagnes dont un canal la désigne (sa liste et sa note de campagne).
                    a.email, a.site, a.logo_uri, a.is_default,
                    (SELECT COUNT(DISTINCT cc.campaign_id) FROM mar_campaign_channel cc WHERE cc.agency_id = a.id) AS channel_campaigns,
                    l.code      AS lever_code,
                    l.label     AS lever_label,
                    l.color_hex AS lever_color_hex,
                    COUNT(ac.id)                        AS interventions,
                    COALESCE(SUM(ac.fee_amount), 0)     AS fees_total,
                    AVG(ac.roi_value)                   AS roi_measured
               FROM mar_agency a
               LEFT JOIN mar_lever l            ON l.id = a.main_lever_id
               LEFT JOIN mar_agency_campaign ac ON ac.agency_id = a.id
              GROUP BY a.id, a.name, a.speciality, a.avg_roi, a.hit_rate_pct,
                       a.avg_cost_amount, a.campaigns_count, l.code, l.label, l.color_hex
              ORDER BY a.name'
        )->fetchAll();

        return array_map([$this, 'cast'], $rows);
    }

    /** Une agence, telle que les routes d'écriture la rendent ; null si elle n'existe pas. */
    public function find(int $id): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT a.id, a.name, a.email, a.site, a.logo_uri, a.is_default,
                    (SELECT COUNT(DISTINCT cc.campaign_id) FROM mar_campaign_channel cc WHERE cc.agency_id = a.id) AS channel_campaigns
               FROM mar_agency a WHERE a.id = :id'
        );
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        return is_array($row) ? $this->cast($row) : null;
    }

    /**
     * Crée une agence. `isDefault` vrai : elle devient la seule agence par défaut (celle qui signe la note d'une
     * campagne dont aucun canal ne désigne d'agence) ; deux « par défaut » ne voudraient rien dire.
     *
     * @param array<string,mixed> $fields clés de WRITABLE, déjà validées
     */
    public function create(array $fields, ?int $userId): int
    {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $columns = ['created_by'];
            $values  = ['created_by' => $userId];
            foreach (self::WRITABLE as $field => $column) {
                if (array_key_exists($field, $fields)) {
                    $columns[] = $column;
                    $values[$column] = $field === 'isDefault' ? (int) (bool) $fields[$field] : $fields[$field];
                }
            }
            $pdo->prepare(sprintf(
                'INSERT INTO mar_agency (%s) VALUES (%s)',
                implode(', ', $columns),
                implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns))
            ))->execute($values);
            $id = (int) $pdo->lastInsertId();
            if (!empty($fields['isDefault'])) {
                $this->onlyDefault($id);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return $id;
    }

    /**
     * Modifie les champs envoyés, et eux seuls (PATCH). `isDefault` vrai : les autres agences cessent de l'être.
     *
     * @param array<string,mixed> $fields clés de WRITABLE, déjà validées
     */
    public function update(int $id, array $fields): void
    {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $sets   = [];
            $values = ['id' => $id];
            foreach (self::WRITABLE as $field => $column) {
                if (array_key_exists($field, $fields)) {
                    $sets[] = $column . ' = :' . $column;
                    $values[$column] = $field === 'isDefault' ? (int) (bool) $fields[$field] : $fields[$field];
                }
            }
            if ($sets !== []) {
                $pdo->prepare('UPDATE mar_agency SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($values);
            }
            if (!empty($fields['isDefault'])) {
                $this->onlyDefault($id);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Ce qui désigne une agence : les canaux de campagne et les interventions enregistrées. Une agence désignée ne
     * s'efface pas — les canaux la perdraient (SET NULL) et ses interventions partiraient avec elle (CASCADE) : les
     * campagnes passées ne diraient plus qui les a faites.
     *
     * @return array{channels:int, interventions:int}
     */
    public function usage(int $id): array
    {
        $statement = Database::connection()->prepare(
            'SELECT (SELECT COUNT(*) FROM mar_campaign_channel WHERE agency_id = :a) AS channels,
                    (SELECT COUNT(*) FROM mar_agency_campaign WHERE agency_id = :b) AS interventions'
        );
        $statement->execute(['a' => $id, 'b' => $id]);
        $row = $statement->fetch() ?: [];

        return ['channels' => (int) ($row['channels'] ?? 0), 'interventions' => (int) ($row['interventions'] ?? 0)];
    }

    public function delete(int $id): void
    {
        Database::connection()->prepare('DELETE FROM mar_agency WHERE id = :id')->execute(['id' => $id]);
    }

    private function onlyDefault(int $id): void
    {
        Database::connection()->prepare('UPDATE mar_agency SET is_default = 0 WHERE id <> :id AND is_default <> 0')
            ->execute(['id' => $id]);
    }

    /**
     * Interventions détaillées, pour la fiche d'une agence.
     *
     * @return list<array<string,mixed>>
     */
    public function interventions(int $agencyId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT ac.id, ac.fee_amount, ac.roi_value,
                    c.name  AS campaign_name,
                    ch.label AS channel_label
               FROM mar_agency_campaign ac
               JOIN mar_campaign c      ON c.id = ac.campaign_id
               LEFT JOIN mar_channel ch ON ch.id = ac.channel_id
              WHERE ac.agency_id = :id
              ORDER BY c.starts_on DESC'
        );
        $statement->execute(['id' => $agencyId]);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Postes de coût agrégés par nature, tous exercices confondus.
     *
     * L'écran ROI les affiche avec leur source de calcul : c'est ce qui permet
     * de contester un chiffre, donc de lui faire confiance.
     *
     * @return list<array<string,mixed>>
     */
    public function costsByKind(): array
    {
        $rows = Database::connection()->query(
            'SELECT rc.cost_kind,
                    COUNT(*)          AS lines_count,
                    SUM(rc.amount)    AS total_amount,
                    GROUP_CONCAT(DISTINCT rc.source_label SEPARATOR " · ") AS sources
               FROM mar_roi_cost rc
              GROUP BY rc.cost_kind
              ORDER BY total_amount DESC'
        )->fetchAll();

        return array_map([$this, 'cast'], $rows);
    }

    /**
     * @param  array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function cast(array $row): array
    {
        foreach ($row as $key => $value) {
            if ($key === 'is_default' && $value !== null) {
                $row[$key] = (bool) (int) $value;
                continue;
            }
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (
                str_ends_with($key, '_amount') || str_ends_with($key, '_pct')
                || in_array($key, ['avg_roi', 'roi_value', 'roi_measured', 'fees_total', 'total_amount'], true)
            ) {
                $row[$key] = (float) $value;
            } elseif ($key === 'id' || str_ends_with($key, '_id') || str_ends_with($key, '_count')
                || in_array($key, ['interventions', 'lines_count', 'channel_campaigns'], true)) {
                $row[$key] = (int) $value;
            }
        }

        return $row;
    }
}
