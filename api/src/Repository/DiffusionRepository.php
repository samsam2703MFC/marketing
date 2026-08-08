<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;

/**
 * Diffusion : supports physiques et déclinaisons digitales.
 *
 * Les deux écrans lisent la même chose — les canaux activés par campagne et les
 * visuels produits — filtrés par famille de canal. Une seule requête paramétrée
 * plutôt que deux presque identiques : elles auraient divergé à la première
 * évolution.
 */
final class DiffusionRepository
{
    /**
     * Canaux activés, par campagne, pour une famille donnée.
     *
     * @param 'PHYSIQUE'|'DIGITAL' $family
     * @return list<array<string,mixed>>
     */
    public function channels(AuthContext $auth, string $family): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');
        $bindings['family']    = $family;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT cc.id, cc.budget_amount, cc.is_enabled,
                    ch.code  AS channel_code,
                    ch.label AS channel_label,
                    ch.family,
                    c.id     AS campaign_id,
                    c.name   AS campaign_name,
                    st.label    AS status_label,
                    st.text_hex AS status_text_hex,
                    st.bg_rgba  AS status_bg_rgba,
                    a.name   AS agency_name
               FROM mar_campaign_channel cc
               JOIN mar_channel ch             ON ch.id = cc.channel_id
               JOIN mar_campaign c             ON c.id = cc.campaign_id
               JOIN mar_campaign_status st     ON st.code = c.status_code
               LEFT JOIN mar_agency a          ON a.id = cc.agency_id
              WHERE ch.family = :family AND %s
              ORDER BY c.starts_on DESC, ch.sort_order',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Visuels de campagne et leurs déclinaisons par format.
     *
     * @return list<array<string,mixed>>
     */
    public function renders(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT ar.id, ar.file_url, ar.override_file_url, ar.status,
                    f.code  AS format_code,
                    f.name  AS format_name,
                    f.width_px, f.height_px, f.note,
                    ca.file_url AS master_file_url,
                    ca.focal_point_y,
                    c.id   AS campaign_id,
                    c.name AS campaign_name
               FROM mar_asset_render ar
               JOIN mar_format f          ON f.id = ar.format_id
               JOIN mar_campaign_asset ca ON ca.id = ar.campaign_asset_id
               JOIN mar_campaign c        ON c.id = ca.campaign_id
              WHERE %s
              ORDER BY c.starts_on DESC, f.sort_order',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Tenues et accessoires terrain rattachés à des campagnes.
     *
     * @return list<array<string,mixed>>
     */
    public function uniforms(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT u.id, u.code, u.name, u.description, u.icon_path,
                    c.id AS campaign_id, c.name AS campaign_name
               FROM mar_uniform u
               LEFT JOIN mar_campaign c ON c.id = u.campaign_id
              WHERE u.is_active = 1 AND (u.campaign_id IS NULL OR %s)
              ORDER BY u.sort_order',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
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

            if (str_ends_with($key, '_amount') || $key === 'focal_point_y') {
                $row[$key] = (float) $value;
            } elseif ($key === 'id' || str_ends_with($key, '_id') || str_ends_with($key, '_px')) {
                $row[$key] = (int) $value;
            }
        }

        if (array_key_exists('is_enabled', $row)) {
            $row['is_enabled'] = (bool) $row['is_enabled'];
        }

        return $row;
    }
}
