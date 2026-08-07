<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;

/**
 * Référentiels.
 *
 * Un seul appel renvoie tous les jeux de valeurs que le prototype portait en dur :
 * leviers, statuts, types de campagne, états de lead, secteurs, formats, postes,
 * canaux, accessoires, templates d'offre. Le front n'a plus aucune palette ni
 * aucune liste en constante — il affiche ce que la base lui donne.
 *
 * Un appel groupé plutôt que dix : ces tables tiennent en quelques dizaines de
 * lignes, et l'application en a besoin dès le premier écran.
 */
final class ReferenceRepository
{
    /** @return array<string, list<array<string,mixed>>> */
    public function all(): array
    {
        return [
            'levers'          => $this->levers(),
            'campaignStatuses'=> $this->campaignStatuses(),
            'campaignTypes'   => $this->campaignTypes(),
            'leadStatuses'    => $this->leadStatuses(),
            'b2bSectors'      => $this->b2bSectors(),
            'formats'         => $this->formats(),
            'positions'       => $this->positions(),
            'channels'        => $this->channels(),
            'uniforms'        => $this->uniforms(),
            'offerTemplates'  => $this->offerTemplates(),
        ];
    }

    /** @return list<array<string,mixed>> */
    public function levers(): array
    {
        return $this->fetch(
            'SELECT id, code, label, color_hex, sort_order
               FROM mar_lever WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function campaignStatuses(): array
    {
        return $this->fetch(
            'SELECT code, label, text_hex, bg_rgba, sort_order
               FROM mar_campaign_status ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function campaignTypes(): array
    {
        return $this->fetch(
            'SELECT id, code, label, default_lever_code, default_kpi_label, icon_path, sort_order
               FROM mar_campaign_type WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function leadStatuses(): array
    {
        return $this->fetch(
            'SELECT code, label, color_hex, bg_hex, border_hex, sort_order
               FROM mar_lead_status ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function b2bSectors(): array
    {
        return $this->fetch(
            'SELECT id, code, label, estimated_leads_count, sort_order
               FROM mar_b2b_sector WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function formats(): array
    {
        return $this->fetch(
            'SELECT id, code, name, width_px, height_px, note, sort_order
               FROM mar_format WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function positions(): array
    {
        return $this->fetch('SELECT id, code, label, sort_order FROM mar_position ORDER BY sort_order');
    }

    /** @return list<array<string,mixed>> */
    public function channels(): array
    {
        return $this->fetch(
            'SELECT id, code, label, family, sort_order
               FROM mar_channel WHERE is_active = 1 ORDER BY family, sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function uniforms(): array
    {
        return $this->fetch(
            'SELECT id, code, name, description, icon_path, sort_order
               FROM mar_uniform WHERE is_active = 1 AND campaign_id IS NULL ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function offerTemplates(): array
    {
        $templates = $this->fetch(
            'SELECT id, code, label, description, sort_order
               FROM mar_offer_template WHERE is_active = 1 ORDER BY sort_order'
        );

        $items = $this->fetch(
            'SELECT template_id, offer_item_id, quantity
               FROM mar_offer_template_item ORDER BY sort_order'
        );

        $byTemplate = [];
        foreach ($items as $item) {
            $byTemplate[(int) $item['template_id']][] = $item;
        }

        foreach ($templates as &$template) {
            $template['items'] = $byTemplate[(int) $template['id']] ?? [];
        }

        return $templates;
    }

    /** @return list<array<string,mixed>> */
    public function brands(): array
    {
        return $this->fetch(
            'SELECT id, code, name, logo_url FROM mar_brand WHERE is_active = 1 ORDER BY name'
        );
    }

    /** @return list<array<string,mixed>> */
    private function fetch(string $sql): array
    {
        return Database::connection()->query($sql)->fetchAll();
    }
}
