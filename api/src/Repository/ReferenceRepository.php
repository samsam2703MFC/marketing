<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;

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
            'tones'           => $this->tones(),
            'agencyAsks'      => $this->agencyAsks(),
            'b2bOptions'      => $this->b2bOptions(),
            'retroplanningDefaults' => $this->retroplanningDefaults(),
            'clientTargets'      => $this->codeLabels('mar_client_target'),
            'costKinds'          => $this->codeLabels('mar_cost_kind'),
            'fundSources'        => $this->codeLabels('mar_fund_source'),
            'reviewPlatforms'    => $this->codeLabels('mar_review_platform'),
            'salesChannels'      => $this->codeLabels('mar_sales_channel'),
            'promotionMechanics' => $this->codeLabels('mar_promotion_mechanic'),
            'posAnswerTypes'     => $this->fetch(
                'SELECT code, label, hint FROM mar_pos_answer_type ORDER BY sort_order'
            ),
            // Palette par défaut d'une campagne. Elle voyage avec les
            // référentiels plutôt que d'être recopiée dans le front : l'écran
            // l'affiche en filigrane des champs vides, l'impression la rend
            // quand la campagne n'a rien choisi, et les deux lisent la même
            // source.
            'campaignColors'     => CampaignRepository::COLORS,
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
        // La pastille de levier vient de la base : la maquette la déduisait par
        // correspondance de mots-clés sur `default_lever_code`, ce que ce
        // projet remplace. `lever_badge_label` laisse à un type sa formulation
        // propre (« Trafic / notoriété ») sans dupliquer le levier.
        return $this->fetch(
            'SELECT t.id, t.code, t.label, t.default_lever_code, t.default_kpi_label,
                    t.icon_path, t.sort_order, t.lever_id,
                    COALESCE(t.lever_badge_label, l.label) AS lever_label,
                    l.color_hex                            AS lever_color_hex
               FROM mar_campaign_type t
               LEFT JOIN mar_lever l ON l.id = t.lever_id
              WHERE t.is_active = 1
              ORDER BY t.sort_order'
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
        // L'effectif réel accompagne le chiffre de cadrage. Les secteurs
        // viennent maintenant de l'ERP, où rien ne correspond à une intention
        // de démarchage : `estimated_leads_count` y vaut zéro, et afficher
        // « Horeca · 0 » à côté d'un secteur qui contient deux cents comptes
        // ferait renoncer à le cocher.
        return $this->fetch(
            'SELECT s.id, s.code, s.label, s.estimated_leads_count, s.sort_order,
                    (SELECT COUNT(*)
                       FROM mar_b2b_prospect_sector ps
                       JOIN mar_b2b_prospect p ON p.id = ps.prospect_id AND p.is_active = 1
                      WHERE ps.sector_id = s.id) AS available_count
               FROM mar_b2b_sector s
              WHERE s.is_active = 1
              ORDER BY s.sort_order'
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

    /**
     * Référentiel plat code → libellé.
     *
     * Six tables partagent la même forme : elles ne servent qu'à traduire un
     * code stocké en libellé affichable. Une méthode plutôt que six identiques
     * — le nom de table ne vient jamais d'une entrée utilisateur, il est écrit
     * ici même.
     *
     * @return list<array<string,mixed>>
     */
    private function codeLabels(string $table): array
    {
        return $this->fetch(sprintf('SELECT code, label FROM %s ORDER BY sort_order, code', $table));
    }

    /** @return list<array<string,mixed>> */
    public function tones(): array
    {
        return $this->fetch(
            'SELECT id, code, label FROM mar_tone WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function agencyAsks(): array
    {
        return $this->fetch(
            'SELECT id, code, label FROM mar_agency_ask WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function b2bOptions(): array
    {
        return $this->fetch(
            'SELECT id, code, label, description
               FROM mar_b2b_option WHERE is_active = 1 ORDER BY sort_order'
        );
    }

    /**
     * Rétroplanning type, pré-rempli par l'assistant.
     *
     * Ce sont des délais de métier, discutables et révisables — d'où une table
     * plutôt qu'une liste en dur dans l'écran.
     *
     * @return list<array<string,mixed>>
     */
    public function retroplanningDefaults(): array
    {
        return $this->fetch(
            'SELECT d.id, d.label, d.days_before_launch, d.position_id,
                    p.label AS position_label
               FROM mar_retroplanning_default d
               LEFT JOIN mar_position p ON p.id = d.position_id
              WHERE d.is_active = 1
              ORDER BY d.sort_order'
        );
    }

    /** @return list<array<string,mixed>> */
    public function brands(): array
    {
        // `erp_brand_id` accompagne l'identifiant local : c'est lui que l'ERP
        // écrit dans l'adresse d'ouverture du module, et le front n'a pas
        // d'autre moyen de traduire « ?brand=1 » en périmètre.
        $brands = $this->fetch(
            'SELECT id, code, erp_brand_id, name, logo_url
               FROM mar_brand WHERE is_active = 1 ORDER BY name'
        );

        foreach ($brands as &$brand) {
            $brand['id']           = (int) $brand['id'];
            $brand['erp_brand_id'] = $brand['erp_brand_id'] === null ? null : (int) $brand['erp_brand_id'];
        }

        return $brands;
    }

    /**
     * Boutiques du réseau, restreintes au périmètre de l'appelant.
     *
     * L'assistant de campagne s'en sert pour l'étape « périmètre ». Le filtre
     * est en SQL : un franchisé ne doit pas pouvoir rattacher une campagne à la
     * boutique d'un confrère, même en forgeant la requête.
     *
     * @return list<array<string,mixed>>
     */
    public function shops(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 's.id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT s.id, s.code, s.name, s.city, s.brand_id, b.name AS brand_name
               FROM mar_shop s
               LEFT JOIN mar_brand b ON b.id = s.brand_id
              WHERE %s
              ORDER BY b.name, s.name',
            $scopeSql
        ));
        $statement->execute($bindings);

        $shops = $statement->fetchAll();
        foreach ($shops as &$shop) {
            $shop['id']       = (int) $shop['id'];
            $shop['brand_id'] = $shop['brand_id'] === null ? null : (int) $shop['brand_id'];
        }

        return $shops;
    }

    /** @return list<array<string,mixed>> */
    private function fetch(string $sql): array
    {
        return Database::connection()->query($sql)->fetchAll();
    }
}
