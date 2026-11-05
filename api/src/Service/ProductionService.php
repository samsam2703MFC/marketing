<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\ProductionRepository;
use Marketing\Support\AuthContext;

/**
 * Le fil de production d'une campagne validée (maquette du 05/11/2026).
 *
 * Les sections ne se déclarent pas : elles se déduisent de la campagne — le
 * message, chaque support coché à l'assistant, les consignes s'il y a des
 * questions en caisse, les tenues s'il y en a, la prime si elle est attachée.
 * Chacune va de « à faire » à « validée ». Les bâches et les affiches se
 * valident boutique par boutique (le BAT de chaque emplacement) : leur section
 * ne se ferme que quand toutes les boutiques ont validé.
 *
 * Le kit des franchisés s'ouvre quand toutes les sections sont validées.
 */
final class ProductionService
{
    public const STATUSES      = ['todo', 'doing', 'ready', 'validated'];
    public const SHOP_STATUSES = ['todo', 'sent', 'validated', 'redo'];
    /** Les supports propres à chaque boutique : un BAT par boutique. */
    public const PER_SHOP      = ['affichage', 'affiches'];
    public const GROUPS        = ['message', 'boutique', 'exterieur', 'social', 'google', 'direct', 'equipe'];
    public const GROUP_LABELS  = [
        'message' => 'Message', 'boutique' => 'En boutique', 'exterieur' => 'Extérieur', 'social' => 'Réseaux sociaux',
        'google' => 'Google', 'direct' => 'Direct', 'equipe' => 'Équipe',
    ];
    public const NOTE_MAX = 300;

    public function __construct(private readonly ProductionRepository $production = new ProductionRepository())
    {
    }

    /**
     * Les sections de la campagne, dans l'ordre du fil, avec leur état.
     *
     * @param  array<string,mixed> $campaign Lu par CampaignRepository::find.
     * @return array{sections: list<array<string,mixed>>, shops: list<array<string,mixed>>, validated: int, total: int, kitReady: bool}
     */
    public function build(AuthContext $auth, array $campaign): array
    {
        $id       = (int) $campaign['id'];
        $only     = $auth->isBrandAdmin() ? null : $auth->shopIds;
        $allShops = $this->production->shops($id, (int) $campaign['brand_id']);
        $shops    = $only === null ? $allShops : array_values(array_filter($allShops, static fn ($s) => in_array((int) $s['id'], $only, true)));
        $states   = $this->production->states($id);
        $perShop  = $this->production->shopStates($id);
        $supports = $this->production->shopSupports(array_map(static fn ($s) => (int) $s['id'], $shops));
        $startsOn = $campaign['starts_on'] ?? null;

        $defs = [['code' => 'message', 'label' => 'Message & visuels', 'grp' => 'message', 'description' => 'Le message de la campagne et ses visuels, déclinés sur tous les supports', 'lead_days' => null, 'editor' => null]];
        foreach ($this->production->channels($id) as $channel) {
            $defs[] = $channel;
        }
        if (!empty($campaign['pos_survey_enabled']) || ($campaign['pos_questions'] ?? []) !== []) {
            $defs[] = ['code' => 'consignes', 'label' => 'Consignes équipe', 'grp' => 'boutique', 'description' => 'Ce que l’équipe dit et demande en caisse', 'lead_days' => 1, 'editor' => null];
        }
        if (($campaign['uniforms'] ?? []) !== []) {
            $defs[] = ['code' => 'tenues', 'label' => 'Tenues', 'grp' => 'boutique', 'description' => implode(' · ', (array) $campaign['uniforms']), 'lead_days' => 1, 'editor' => null];
        }
        if (!empty($campaign['show_web_shop'])) {
            $defs[] = ['code' => 'vitrine', 'label' => 'Vitrine du webshop', 'grp' => 'direct', 'description' => 'La campagne en vitrine de la boutique en ligne', 'lead_days' => 2, 'editor' => null];
        }
        if (!empty($campaign['staff_bonus_enabled'])) {
            $defs[] = ['code' => 'prime', 'label' => 'Prime du personnel', 'grp' => 'equipe', 'description' => 'La prime de la marque pour les équipes de vente', 'lead_days' => null, 'editor' => null];
        }

        $order = array_flip(self::GROUPS);
        usort($defs, static fn ($a, $b) => ($order[$a['grp']] ?? 99) <=> ($order[$b['grp']] ?? 99));

        $sections = [];
        $validated = 0;
        foreach ($defs as $def) {
            $code  = (string) $def['code'];
            $state = $states[$code] ?? null;
            $status = $state !== null ? (string) $state['status'] : 'todo';
            $section = [
                'code'        => $code,
                'label'       => (string) $def['label'],
                'group'       => (string) ($def['grp'] ?: 'boutique'),
                'groupLabel'  => self::GROUP_LABELS[(string) ($def['grp'] ?: 'boutique')] ?? '',
                'description' => $def['description'] ?? null,
                'editor'      => $def['editor'] ?? null,
                'quantity'    => isset($def['quantity']) ? (int) $def['quantity'] : null,
                'details'     => $def['details'] ?? null,
                'agency'      => $def['agency_name'] ?? null,
                'isPaid'      => !empty($def['is_paid']),
                'dueOn'       => $this->dueOn($startsOn, $def['lead_days'] ?? null),
                'status'      => $status,
                'note'        => $state['note'] ?? null,
                'validatedAt' => isset($state['validated_at']) ? $this->iso((string) $state['validated_at']) : null,
                'perShop'     => in_array($code, self::PER_SHOP, true),
                'shops'       => [],
            ];
            if ($section['perShop']) {
                $kind = $code === 'affichage' ? 'bache' : 'affiche';
                $done = 0;
                foreach ($shops as $shop) {
                    $sid = (int) $shop['id'];
                    $row = $perShop[$code][$sid] ?? null;
                    $own = array_values(array_filter($supports[$sid] ?? [], static fn ($s) => $s['kind'] === $kind));
                    $section['shops'][] = [
                        'shopId'   => $sid,
                        'shopName' => (string) $shop['name'],
                        'status'   => $row !== null ? (string) $row['status'] : 'todo',
                        'note'     => $row['note'] ?? null,
                        'supports' => array_map([$this, 'support'], $own),
                    ];
                    if ($row !== null && $row['status'] === 'validated') {
                        $done++;
                    }
                }
                $section['shopsValidated'] = $done;
            }
            if ($status === 'validated') {
                $validated++;
            }
            $sections[] = $section;
        }

        return [
            'sections'  => $sections,
            'shops'     => array_map(static fn ($s) => ['shopId' => (int) $s['id'], 'shopName' => (string) $s['name'], 'city' => $s['city']], $shops),
            'validated' => $validated,
            'total'     => count($sections),
            'kitReady'  => $sections !== [] && $validated === count($sections),
        ];
    }

    /**
     * Valide la mise à jour d'une section.
     *
     * @return array{status?: string, note?: ?string, errors: list<array{field:string,message:string}>}
     */
    public function validateState(array $body, array $allowed): array
    {
        $errors = [];
        foreach (array_diff(array_keys($body), ['status', 'note']) as $key) {
            $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
        }
        $status = $body['status'] ?? null;
        if (!is_string($status) || !in_array($status, $allowed, true)) {
            $errors[] = ['field' => 'status', 'message' => 'Valeurs : ' . implode(' | ', $allowed) . '.'];
        }
        $note = $body['note'] ?? null;
        if ($note !== null && (!is_string($note) || mb_strlen($note) > self::NOTE_MAX)) {
            $errors[] = ['field' => 'note', 'message' => 'Texte de ' . self::NOTE_MAX . ' caractères au plus.'];
        }
        $note = is_string($note) ? (trim($note) === '' ? null : trim($note)) : null;

        return ['status' => is_string($status) ? $status : '', 'note' => $note, 'errors' => $errors];
    }

    /** @param array<string,mixed> $s */
    private function support(array $s): array
    {
        return [
            'placement'   => $s['placement'],
            'widthCm'     => $s['width_cm'] !== null ? (int) $s['width_cm'] : null,
            'heightCm'    => $s['height_cm'] !== null ? (int) $s['height_cm'] : null,
            'paperFormat' => $s['paper_format'],
            'quantity'    => (int) $s['quantity'],
            'material'    => $s['material'],
            'fixing'      => $s['fixing'],
        ];
    }

    private function dueOn(mixed $startsOn, mixed $leadDays): ?string
    {
        if (!is_string($startsOn) || $startsOn === '' || $leadDays === null) {
            return null;
        }
        $t = strtotime(substr($startsOn, 0, 10) . ' 00:00:00 UTC');

        return $t === false ? null : gmdate('Y-m-d', $t - (int) $leadDays * 86400);
    }

    private function iso(string $datetime): string
    {
        return str_replace(' ', 'T', $datetime) . 'Z';
    }
}
