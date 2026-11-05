<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\ProductionRepository;
use Marketing\Support\Database;
use Marketing\Support\Keys;

/**
 * Le kit d'une campagne pour une boutique (maquette du 05/11/2026) : ce que la
 * boutique affiche, porte, dit et publie, avec ses dates. Lu sur la tablette de
 * la boutique et imprimé en A4 (le PDF).
 *
 * Il se monte à partir de ce que la campagne a déjà : message, offre, supports
 * cochés, bâches et affiches déclarées de la boutique, tenues, questions en
 * caisse, prime. Le calendrier des posts vient de Social (Créer un post) : le
 * réseau l'apporte à l'envoi, et le kit le fige avec le reste.
 *
 * Le lien d'une boutique ne se garde pas : il se recalcule (HMAC du secret de
 * session et d'un sel tiré une fois). La base n'en garde que l'empreinte.
 */
final class KitService
{
    public const POSTS_MAX   = 300;
    public const NETWORKS    = ['fb', 'ig', 'google'];
    public const POST_KINDS  = ['post', 'story'];
    /** Supports dont la boutique s'occupe elle-même : ils font une date dans son kit. */
    private const SHOP_TASKS = [
        'affichage'     => 'Pose des bâches',
        'affiches'      => 'Affiches en place',
        'ecrans'        => 'Visuels sur les écrans',
        'plv'           => 'PLV en place',
        'animation'     => 'Animation en boutique',
        'bons_imprimes' => 'Bons imprimés reçus, à remettre en caisse',
        'goodies'       => 'Goodies reçus',
        'tenues'        => 'Tenues portées par l’équipe',
        'consignes'     => 'Consignes partagées avec l’équipe',
    ];
    private const FORM_LABELS = ['voucher' => 'en bon d’achat', 'gift_cheque' => 'en chèques cadeaux', 'franchisee' => 'versée au franchisé, qui la redistribue'];

    public function __construct(private readonly ProductionRepository $production = new ProductionRepository())
    {
    }

    /**
     * Le kit d'une boutique.
     *
     * @param array<string,mixed>      $campaign Lu par CampaignRepository::find.
     * @param array<string,mixed>      $built    ProductionService::build (vue réseau).
     * @param array<string,mixed>      $shop     Ligne de ProductionRepository::shops.
     * @param list<array<string,mixed>> $posts    Posts validés par validatePosts.
     */
    public function build(array $campaign, array $built, array $shop, array $posts): array
    {
        $shopId  = (int) $shop['id'];
        $erpId   = $shop['erp_shop_id'] !== null ? (string) $shop['erp_shop_id'] : null;
        $offer   = is_array($campaign['offer'] ?? null) ? $campaign['offer'] : null;

        $sections = [];
        foreach ($built['sections'] as $section) {
            $sections[$section['code']] = $section;
        }

        $dates = [];
        foreach (self::SHOP_TASKS as $code => $label) {
            if (isset($sections[$code])) {
                $dates[] = ['on' => $sections[$code]['dueOn'] ?? $campaign['starts_on'] ?? null, 'label' => $label, 'shopTask' => true];
            }
        }
        if (!empty($campaign['starts_on'])) {
            $dates[] = ['on' => $campaign['starts_on'], 'label' => 'Lancement de la campagne', 'shopTask' => false];
        }
        if ($offer !== null && !empty($offer['ends_on']) && $offer['ends_on'] !== ($campaign['ends_on'] ?? null)) {
            $dates[] = ['on' => $offer['ends_on'], 'label' => 'Fin de l’offre', 'shopTask' => false];
        }
        if (!empty($campaign['ends_on'])) {
            $dates[] = ['on' => $campaign['ends_on'], 'label' => 'Fin de la campagne', 'shopTask' => false];
        }
        $dates = array_values(array_filter($dates, static fn ($d) => is_string($d['on']) && $d['on'] !== ''));
        usort($dates, static fn ($a, $b) => strcmp((string) $a['on'], (string) $b['on']));

        $displays = ['baches' => [], 'affiches' => []];
        foreach (['affichage' => 'baches', 'affiches' => 'affiches'] as $code => $key) {
            foreach (($sections[$code]['shops'] ?? []) as $row) {
                if ($row['shopId'] === $shopId) {
                    $displays[$key] = $row['supports'];
                }
            }
        }

        $supports = [];
        foreach ($sections as $code => $section) {
            if (in_array($code, ['message', 'prime', 'consignes', 'tenues'], true)) {
                continue;
            }
            $supports[] = [
                'code' => $code, 'label' => $section['label'], 'group' => $section['groupLabel'],
                'quantity' => $section['quantity'], 'details' => $section['details'], 'dueOn' => $section['dueOn'],
                'agency' => $section['agency'],
            ];
        }

        $shopPosts = array_values(array_filter($posts, static fn (array $p): bool => $p['shops'] === [] || ($erpId !== null && in_array($erpId, $p['shops'], true))));
        $shopPosts = array_map(static function (array $p): array {
            unset($p['shops']);
            return $p;
        }, $shopPosts);

        return [
            'campaign' => [
                'id' => (int) $campaign['id'], 'name' => (string) $campaign['name'],
                'startsOn' => $campaign['starts_on'] ?? null, 'endsOn' => $campaign['ends_on'] ?? null,
                'typeLabel' => $campaign['type_label'] ?? null,
            ],
            'shop'     => ['id' => $shopId, 'name' => (string) $shop['name'], 'city' => $shop['city'] ?? null, 'erpShopId' => $erpId],
            'messages' => $this->messages((int) $campaign['id']),
            'offer'    => $offer === null ? null : [
                'title' => $offer['title'] ?? null, 'mechanicText' => $offer['mechanic_text'] ?? null,
                'priceLabel' => $offer['price_label'] ?? null, 'discountLabel' => $offer['discount_label'] ?? null,
                'startsOn' => $offer['starts_on'] ?? null, 'endsOn' => $offer['ends_on'] ?? null,
                'items' => array_values(array_map(static fn ($i) => ['label' => (string) ($i['label'] ?? '')], (array) ($offer['items'] ?? []))),
            ],
            'dates'    => $dates,
            'posts'    => $shopPosts,
            'displays' => $displays,
            'supports' => $supports,
            'uniforms' => array_values(array_map('strval', (array) ($campaign['uniforms'] ?? []))),
            'counter'  => [
                'enabled'   => isset($sections['consignes']),
                'questions' => array_values(array_map(static fn ($q) => (string) ($q['label'] ?? ''), (array) ($campaign['pos_questions'] ?? []))),
            ],
            'bonus'    => $this->bonus($campaign, $shop),
        ];
    }

    /**
     * Les posts apportés par le réseau (lus dans Social), validés un à un.
     *
     * @return array{posts: list<array<string,mixed>>, errors: list<array{field:string,message:string}>}
     */
    public function validatePosts(mixed $input): array
    {
        if ($input === null) {
            return ['posts' => [], 'errors' => []];
        }
        if (!is_array($input) || !array_is_list($input)) {
            return ['posts' => [], 'errors' => [['field' => 'posts', 'message' => 'Liste attendue.']]];
        }
        if (count($input) > self::POSTS_MAX) {
            return ['posts' => [], 'errors' => [['field' => 'posts', 'message' => self::POSTS_MAX . ' posts au plus.']]];
        }
        $posts = []; $errors = [];
        foreach ($input as $i => $p) {
            $f = 'posts[' . $i . ']';
            if (!is_array($p)) {
                $errors[] = ['field' => $f, 'message' => 'Objet attendu.'];
                continue;
            }
            foreach (array_diff(array_keys($p), ['date', 'time', 'title', 'text', 'image', 'networks', 'kind', 'shops']) as $k) {
                $errors[] = ['field' => $f . '.' . $k, 'message' => 'Champ inconnu.'];
            }
            $date = $p['date'] ?? null;
            if (!is_string($date) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1 || !checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4))) {
                $errors[] = ['field' => $f . '.date', 'message' => 'Date AAAA-MM-JJ attendue.'];
            }
            $time = $p['time'] ?? null;
            if ($time !== null && (!is_string($time) || preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time) !== 1)) {
                $errors[] = ['field' => $f . '.time', 'message' => 'Heure HH:MM attendue.'];
            }
            $title = $p['title'] ?? null;
            if (!is_string($title) || trim($title) === '' || mb_strlen($title) > 200) {
                $errors[] = ['field' => $f . '.title', 'message' => 'Titre de 1 à 200 caractères.'];
            }
            $text = $p['text'] ?? null;
            if ($text !== null && !is_string($text)) {
                $errors[] = ['field' => $f . '.text', 'message' => 'Texte attendu.'];
            }
            $image = $p['image'] ?? null;
            if ($image !== null && (!is_string($image) || mb_strlen($image) > 500 || preg_match('#^https?://[^\s"\'<>]+$#', $image) !== 1)) {
                $errors[] = ['field' => $f . '.image', 'message' => 'Adresse http(s) absolue attendue.'];
            }
            $networks = $p['networks'] ?? [];
            if (!is_array($networks) || array_diff($networks, self::NETWORKS) !== []) {
                $errors[] = ['field' => $f . '.networks', 'message' => 'Réseaux : ' . implode(' | ', self::NETWORKS) . '.'];
            }
            $kind = $p['kind'] ?? 'post';
            if (!in_array($kind, self::POST_KINDS, true)) {
                $errors[] = ['field' => $f . '.kind', 'message' => 'post | story.'];
            }
            $shops = $p['shops'] ?? [];
            if (!is_array($shops) || count($shops) > 200 || array_filter($shops, static fn ($s) => !is_string($s) || preg_match('/^\d{1,9}$/', $s) !== 1) !== []) {
                $errors[] = ['field' => $f . '.shops', 'message' => 'Identifiants de boutique de l’ERP (chaînes de chiffres).'];
            }
            $posts[] = [
                'date' => $date, 'time' => $time, 'title' => is_string($title) ? trim($title) : '',
                'text' => is_string($text) ? mb_substr(trim($text), 0, 600) : null, 'image' => $image,
                'networks' => is_array($networks) ? array_values(array_unique($networks)) : [], 'kind' => $kind,
                'shops' => is_array($shops) ? array_values(array_unique($shops)) : [],
            ];
        }
        usort($posts, static fn ($a, $b) => strcmp($a['date'] . ($a['time'] ?? ''), $b['date'] . ($b['time'] ?? '')));

        return ['posts' => $errors === [] ? $posts : [], 'errors' => $errors];
    }

    /** Le lien d'une boutique : null si le secret de session manque. */
    public function token(int $campaignId, int $shopId, string $salt): ?string
    {
        $secret = (string) (Keys::get('MAR_SESSION_SECRET') ?? '');
        if (strlen($secret) < 32) {
            return null;
        }
        $raw = hash_hmac('sha256', 'kit:' . $campaignId . ':' . $shopId . ':' . $salt, $secret, true);

        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function tokenHash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function newSalt(): string
    {
        return bin2hex(random_bytes(16));
    }

    /** Un lien vaut jusqu'à 30 jours après la fin de la campagne, et 60 jours au moins. */
    public static function expiresOn(?string $endsOn): string
    {
        $floor = gmdate('Y-m-d', time() + 60 * 86400);
        if ($endsOn === null || $endsOn === '') {
            return $floor;
        }
        $t = strtotime(substr($endsOn, 0, 10) . ' 00:00:00 UTC');
        $after = $t === false ? $floor : gmdate('Y-m-d', $t + 30 * 86400);

        return max($after, $floor);
    }

    /** @return array<string,array<string,?string>> */
    private function messages(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT lang, title, hook, offer_line, cta FROM mar_campaign_message WHERE campaign_id = :id ORDER BY lang'
        );
        $statement->execute(['id' => $campaignId]);
        $out = [];
        foreach ($statement->fetchAll() as $row) {
            $out[(string) $row['lang']] = ['title' => $row['title'], 'hook' => $row['hook'], 'offerLine' => $row['offer_line'], 'cta' => $row['cta']];
        }

        return $out;
    }

    /** La prime de l'équipe de la boutique, avec ce qu'elle rapporte au seuil et au palier. */
    private function bonus(array $campaign, array $shop): ?array
    {
        if (empty($campaign['staff_bonus_enabled'])) {
            return null;
        }
        $num   = static fn ($v): ?float => $v === null || $v === '' ? null : (float) $v;
        $cents = static fn ($v): ?int => $v === null || $v === '' ? null : (int) round((float) $v * 100);
        $rule      = (string) ($campaign['staff_bonus_rule'] ?? 'attainment');
        $amount    = $cents($campaign['staff_bonus_amount'] ?? null);
        $extra     = $cents($campaign['staff_bonus_extra_amount'] ?? null);
        $cap       = $cents($campaign['staff_bonus_cap_amount'] ?? null);
        $headcount = $shop['staff_headcount'] !== null ? (int) $shop['staff_headcount'] : null;
        $target    = $shop['target_pieces'] !== null ? (int) $shop['target_pieces'] : null;
        $capped    = static fn (?int $v): ?int => $v === null ? null : ($cap !== null ? min($v, $cap) : $v);
        $atThreshold = null; $atExtra = null;
        if ($rule !== 'per_piece' && $amount !== null && $headcount !== null) {
            $atThreshold = $capped($amount * $headcount);
            $atExtra     = $extra !== null ? $capped(($amount + $extra) * $headcount) : null;
        }

        // Montants en centimes (standard §8).
        return [
            'rule'             => $rule,
            'who'              => (string) ($campaign['staff_bonus_who'] ?? 'team'),
            'thresholdPct'     => $num($campaign['staff_bonus_threshold_pct'] ?? null),
            'amountCents'      => $amount,
            'extraPct'         => $num($campaign['staff_bonus_extra_pct'] ?? null),
            'extraAmountCents' => $extra,
            'capAmountCents'   => $cap,
            'form'             => $campaign['staff_bonus_form'] ?? null,
            'formLabel'        => self::FORM_LABELS[(string) ($campaign['staff_bonus_form'] ?? '')] ?? null,
            'paidOn'           => $campaign['staff_bonus_paid_on'] ?? null,
            'targetPieces'     => $target,
            'headcount'        => $headcount,
            'atThresholdCents' => $atThreshold,
            'atExtraCents'     => $atExtra,
            'currency'     => 'EUR',
        ];
    }
}
