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
 */
final class AgencyRepository
{
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
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (
                str_ends_with($key, '_amount') || str_ends_with($key, '_pct')
                || in_array($key, ['avg_roi', 'roi_value', 'roi_measured', 'fees_total', 'total_amount'], true)
            ) {
                $row[$key] = (float) $value;
            } elseif ($key === 'id' || str_ends_with($key, '_id') || str_ends_with($key, '_count')
                || in_array($key, ['interventions', 'lines_count'], true)) {
                $row[$key] = (int) $value;
            }
        }

        return $row;
    }
}
