<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\CampaignRepository;
use Marketing\Repository\CampaignVoucherRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Scope;
use Marketing\Support\WebshopClient;
use Throwable;

/**
 * Les bons d'une campagne.
 *
 * Un bon se crée comme une promotion — une mécanique, ce qu'elle touche, quand
 * elle vaut — mais il vit dans le moteur de bons du webshop : c'est lui qui
 * l'applique au panier. Le module n'en garde rien, pas même le lien : le bon
 * porte la campagne qui le suit, et tout passe par l'API du webshop —
 * création, rattachement, suspension, relecture du bon et de ses commandes.
 *
 * Règles validées :
 *  — un code ne se rattache qu'à une campagne (ses commandes ne comptent
 *    qu'une fois) ;
 *  — webshop seulement : la caisse n'applique pas ces bons ;
 *  — les bons d'une campagne réseau se gèrent au niveau du réseau ; une
 *    campagne locale émet des bons de SA boutique, qui ne valent que chez elle.
 *
 * Mécanique « promotions » : le bon n'a pas de remise propre, il DÉCLENCHE des
 * promotions posées à l'étape « Prix » de la campagne, cochées une à une. Elles
 * partent au webshop avec le code et n'y valent qu'avec lui. Le webshop en
 * garde une copie : quand l'étape Prix change ensuite, la liste le signale
 * (promotions_changed) et « Mettre à jour » renvoie les valeurs du moment.
 */
final class CampaignVoucherService
{
    private const MECHANICS = ['percent', 'fixed', 'product', 'free_delivery', 'promotions'];

    /** Les mécaniques de l'étape Prix que le panier du webshop sait appliquer. */
    private const WEBSHOP_PROMOTIONS = ['PERCENT', 'CROSSED_PRICE', 'BUY_X_GET_Y'];

    public function __construct(
        private readonly CampaignVoucherRepository $refs = new CampaignVoucherRepository(),
        private readonly WebshopClient $webshop = new WebshopClient(),
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
    ) {
    }

    /**
     * Les bons d'une campagne, relus dans le webshop, avec ce qu'ils ont donné.
     *
     * @return array<string,mixed>
     */
    public function forCampaign(AuthContext $auth, int $campaignId): array
    {
        $campaign = $this->campaign($auth, $campaignId, false);
        $lines    = $this->refs->campaignPromotions($campaignId);
        $out      = [
            'configured' => $this->webshop->isConfigured(),
            'message'    => null,
            'can_edit'   => $this->writable($auth, $campaign),
            'vouchers'   => [],
            'totals'     => null,
            // Ce qu'un bon « promotions » peut déclencher : l'étape Prix telle
            // qu'enregistrée, chaque ligne avec ce qui l'empêcherait de partir.
            'campaign_promotions' => array_map(static fn (array $line): array => [
                'offer_item_id' => $line['offer_item_id'],
                'label'         => $line['label'],
                'mechanic'      => $line['mechanic'],
                'mechanic_label'=> $line['mechanic_label'],
                'text'          => self::promotionText($line),
                'webshop'       => self::webshopGap($line) === null,
                'reason'        => self::webshopGap($line),
            ], $lines),
        ];

        if (!$out['configured']) {
            $out['message'] = WebshopClient::missingConfiguration();

            return $out;
        }

        try {
            $rows = array_values(array_filter(
                $this->webshop->get('/franchisor/voucher-codes', ['campaign' => $campaignId]),
                static fn ($row): bool => is_array($row) && isset($row['code'])
            ));
            $use = [];
            if ($rows !== []) {
                $codes = implode(',', array_map(static fn (array $row): string => (string) $row['code'], $rows));
                foreach ($this->webshop->get('/franchisor/voucher-usage', ['codes' => $codes]) as $row) {
                    if (is_array($row) && isset($row['code'])) {
                        $use[(string) $row['code']] = $row;
                    }
                }
            }
        } catch (Throwable $e) {
            // L'écran dit pourquoi la liste manque, au lieu d'une erreur muette.
            $out['message'] = $e->getMessage();

            return $out;
        }

        // Un franchisé voit ce que les bons ont donné CHEZ LUI : le détail des
        // autres boutiques du réseau n'est pas à lui.
        $mine = $auth->isBrandAdmin() ? null : $this->refs->erpShopIds(Scope::shopIds($auth) ?? []);

        $totals = ['orders' => 0, 'revenue' => 0.0, 'discount' => 0.0];
        foreach ($rows as $row) {
            $results = $this->results($use[$row['code']] ?? null, $mine);
            if ($results !== null) {
                $totals['orders']   += $results['orders'];
                $totals['revenue']  += $results['revenue'];
                $totals['discount'] += $results['discount'];
            }
            $out['vouchers'][] = [
                'code'   => (string) $row['code'],
                'origin' => ($row['marCampaignOrigin'] ?? null) === 'created' ? 'created' : 'attached',
            ] + $this->describe($row, $lines) + ['results' => $results];
        }

        $out['totals'] = [
            'orders'         => $totals['orders'],
            'revenue'        => round($totals['revenue'], 2),
            'discount'       => round($totals['discount'], 2),
            'average_basket' => $totals['orders'] > 0 ? round($totals['revenue'] / $totals['orders'], 2) : null,
        ];

        return $out;
    }

    /**
     * Crée un bon dans le webshop, suivi par la campagne dès sa création.
     *
     * @param  array<string,mixed> $input
     * @return array{code:string}
     */
    public function create(AuthContext $auth, int $campaignId, array $input): array
    {
        $campaign = $this->campaign($auth, $campaignId, true);
        $this->assertConfigured();

        $code    = $this->normalizedCode($input['code'] ?? '', true);
        $payload = $this->fields($auth, $campaign, $input, null) + [
            'code'        => $code,
            'create_only' => true,
            'active'      => true,
            'id_shop'     => $this->issuerShop($campaign),
            'campaign_id' => $campaignId,
        ] + $this->provenance($campaign);

        [$status, $body] = $this->webshop->post('/franchisor/voucher', $payload);
        if ($status === 409) {
            throw new VoucherError(sprintf(
                'Le code %s existe déjà dans le webshop : choisissez-en un autre, ou rattachez ce bon existant.',
                $code
            ), 409);
        }
        if ($status >= 400 || !is_string($body['code'] ?? null)) {
            throw new VoucherError('Le webshop refuse le bon : ' . (string) ($body['error'] ?? 'motif non précisé') . '.', 422);
        }

        return ['code' => (string) $body['code']];
    }

    /**
     * Modifie un bon CRÉÉ pour la campagne. Ce qui n'est pas envoyé garde sa
     * valeur du webshop — jamais une valeur par défaut.
     *
     * @param array<string,mixed> $input
     */
    public function update(AuthContext $auth, int $campaignId, string $code, array $input): void
    {
        $campaign = $this->campaign($auth, $campaignId, true);
        $current  = $this->followed($campaignId, $this->normalizedCode($code, false));

        if (($current['marCampaignOrigin'] ?? null) !== 'created') {
            throw new VoucherError('Un bon rattaché se modifie là où il a été créé : la campagne ne fait que le suivre.', 422);
        }

        $payload = $this->fields($auth, $campaign, $input, $current) + [
            'code'    => (string) $current['code'],
            'active'  => (bool) ($current['active'] ?? true),
            'id_shop' => $current['shopId'] ?? null,
        ] + $this->provenance($campaign);

        [$status, $body] = $this->webshop->post('/franchisor/voucher', $payload);
        if ($status >= 400) {
            throw new VoucherError('Le webshop refuse la modification : ' . (string) ($body['error'] ?? 'motif non précisé') . '.', 422);
        }
    }

    /**
     * Rattache un bon existant. Idempotent : le rattacher deux fois à la même
     * campagne ne fait rien la seconde fois.
     *
     * @return array{created:bool}
     */
    public function attach(AuthContext $auth, int $campaignId, string $code): array
    {
        $this->campaign($auth, $campaignId, true);
        $code = $this->normalizedCode($code, false);
        $this->assertConfigured();

        $row = $this->webshop->get('/franchisor/voucher-codes', ['codes' => $code])[0] ?? null;
        if (!is_array($row)) {
            throw new VoucherError('Ce bon n\'existe pas dans le webshop.', 404);
        }

        // Un franchisé ne rattache que les bons de ses boutiques : ni ceux de la
        // marque, ni ceux d'une autre boutique.
        if (!$auth->isBrandAdmin()) {
            $mine = $this->refs->erpShopIds(Scope::shopIds($auth) ?? []);
            if (!isset($row['shopId']) || !in_array((int) $row['shopId'], $mine, true)) {
                throw new VoucherError('Ce bon n\'a pas été émis par votre boutique.', 403);
            }
        }

        [$status, $body] = $this->webshop->post('/franchisor/voucher-campaign', ['code' => $code, 'campaign_id' => $campaignId]);
        if ($status === 409) {
            $other = (int) ($body['campaignId'] ?? 0);
            $name  = $auth->isBrandAdmin() ? ($this->refs->campaignNames([$other])[$other] ?? null) : null;
            throw new VoucherError($name !== null
                ? sprintf('Ce bon est déjà suivi par la campagne « %s ».', $name)
                : 'Ce bon est déjà suivi par une autre campagne.', 409);
        }
        if ($status >= 400) {
            throw new VoucherError('Le webshop refuse le rattachement : ' . (string) ($body['error'] ?? 'motif non précisé') . '.', 422);
        }

        return ['created' => (bool) ($body['created'] ?? true)];
    }

    /**
     * Retire un bon de la campagne. Un bon créé pour elle est SUSPENDU dans le
     * webshop (il cesse de valoir, ses commandes passées le citent toujours) ;
     * un bon rattaché reste tel quel.
     */
    public function detach(AuthContext $auth, int $campaignId, string $code): void
    {
        $this->campaign($auth, $campaignId, true);
        $current = $this->followed($campaignId, $this->normalizedCode($code, false));
        $code    = (string) $current['code'];

        if (($current['marCampaignOrigin'] ?? null) === 'created') {
            [$status, $body] = $this->webshop->post('/franchisor/voucher-active', ['code' => $code, 'active' => false]);
            if ($status >= 400) {
                throw new VoucherError('Le webshop refuse de suspendre le bon : ' . (string) ($body['error'] ?? 'motif non précisé') . '.', 422);
            }
        }

        [$status, $body] = $this->webshop->post('/franchisor/voucher-campaign', [
            'code' => $code, 'campaign_id' => null, 'from_campaign' => $campaignId,
        ]);
        if ($status >= 400) {
            throw new VoucherError('Le webshop refuse de détacher le bon : ' . (string) ($body['error'] ?? 'motif non précisé') . '.', $status === 409 ? 409 : 422);
        }
    }

    /**
     * Les bons du webshop qu'on peut rattacher, avec la campagne qui les suit.
     *
     * @return array<string,mixed>
     */
    public function available(AuthContext $auth, string $query): array
    {
        if (!$this->webshop->isConfigured()) {
            return ['configured' => false, 'message' => WebshopClient::missingConfiguration(), 'vouchers' => []];
        }

        $params = ['q' => trim($query)];
        if (!$auth->isBrandAdmin()) {
            $mine = $this->refs->erpShopIds(Scope::shopIds($auth) ?? []);
            if ($mine === []) {
                return ['configured' => true, 'message' => null, 'vouchers' => []];
            }
            $params['shops'] = implode(',', $mine);
        }

        $rows  = array_values(array_filter($this->webshop->get('/franchisor/voucher-codes', $params), 'is_array'));
        $names = $this->refs->campaignNames(array_map(
            static fn (array $row): int => (int) ($row['marCampaignId'] ?? 0),
            $rows
        ));

        return [
            'configured' => true,
            'message'    => null,
            'vouchers'   => array_map(fn (array $row): array => ['code' => (string) $row['code']] + $this->describe($row) + [
                'campaign_id'   => isset($row['marCampaignId']) ? (int) $row['marCampaignId'] : null,
                'campaign_name' => isset($row['marCampaignId']) ? ($names[(int) $row['marCampaignId']] ?? null) : null,
            ], $rows),
        ];
    }

    /**
     * Bureaux du webshop, pour un bon qui leur est réservé. Réservé à la marque :
     * la liste couvre les clients B2B de tout le réseau.
     *
     * @return list<array{id:int, name:string, city:?string}>
     */
    public function offices(AuthContext $auth, string $query): array
    {
        if (!$auth->isBrandAdmin()) {
            throw new VoucherError('La liste des bureaux du réseau est réservée à la marque.', 403);
        }
        $this->assertConfigured();

        return array_values(array_map(static fn (array $row): array => [
            'id'   => (int) $row['id'],
            'name' => (string) $row['name'],
            'city' => isset($row['city']) ? (string) $row['city'] : null,
        ], array_filter($this->webshop->get('/franchisor/offices', ['q' => trim($query)]), 'is_array')));
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function campaign(AuthContext $auth, int $id, bool $write): array
    {
        $campaign = $this->campaigns->find($auth, $id);
        if ($campaign === null) {
            throw new VoucherError('Campagne introuvable.', 404);
        }
        if ($write && !$this->writable($auth, $campaign)) {
            throw new VoucherError('Les bons d\'une campagne réseau se gèrent au niveau du réseau.', 403);
        }

        return $campaign;
    }

    /** @param array<string,mixed> $campaign */
    private function writable(AuthContext $auth, array $campaign): bool
    {
        return $auth->isBrandAdmin() || ($campaign['scope'] ?? null) === 'LOCALE';
    }

    private function assertConfigured(): void
    {
        if (!$this->webshop->isConfigured()) {
            throw new VoucherError(WebshopClient::missingConfiguration(), 503);
        }
    }

    /**
     * Le bon tel que le webshop le sert, s'il est bien suivi par CETTE campagne.
     *
     * @return array<string,mixed>
     */
    private function followed(int $campaignId, string $code): array
    {
        $this->assertConfigured();
        $row = $this->webshop->get('/franchisor/voucher-codes', ['codes' => $code])[0] ?? null;
        if (!is_array($row) || (int) ($row['marCampaignId'] ?? 0) !== $campaignId) {
            throw new VoucherError('Ce bon n\'est pas suivi par cette campagne.', 404);
        }

        return $row;
    }

    /** Code saisi : majuscules, chiffres et tirets. Vide permis à la création (le webshop le génère). */
    private function normalizedCode(mixed $value, bool $emptyAllowed): string
    {
        $code = strtoupper(trim((string) $value));
        if ($code === '' && $emptyAllowed) {
            return '';
        }
        if (preg_match('/^[A-Z0-9][A-Z0-9-]{2,29}$/', $code) !== 1) {
            throw new VoucherError('Code attendu : 3 à 30 caractères, lettres, chiffres et tirets.', 422);
        }

        return $code;
    }

    /**
     * Émetteur : la marque pour une campagne réseau, LA boutique d'une campagne
     * locale — son bon ne vaut que chez elle, comme un bon du BO franchisé.
     *
     * @param array<string,mixed> $campaign
     */
    private function issuerShop(array $campaign): ?int
    {
        if (($campaign['scope'] ?? null) !== 'LOCALE') {
            return null;
        }

        $shops = $this->refs->campaignShopIds((int) $campaign['id']);
        if (count($shops) !== 1) {
            throw new VoucherError(
                'Un bon de boutique ne vaut que dans une boutique : cette campagne locale en compte '
                . count($shops) . '. Créez le bon depuis une campagne d\'une seule boutique.',
                422
            );
        }

        $erp = $this->refs->erpShopIds($shops);
        if ($erp === []) {
            throw new VoucherError('La boutique de cette campagne n\'est pas rapprochée de l\'ERP (reprise ERP à relancer) : le webshop ne la connaîtrait pas.', 422);
        }

        return $erp[0];
    }

    /**
     * @param  array<string,mixed> $campaign
     * @return array<string,mixed>
     */
    private function provenance(array $campaign): array
    {
        return [
            'source'      => 'marketing',
            'reason_kind' => 'MARKETING',
            'reason_note' => mb_substr(sprintf('Campagne #%d — %s', (int) $campaign['id'], (string) ($campaign['name'] ?? '')), 0, 255),
        ];
    }

    /**
     * La définition du bon, au vocabulaire du webshop. À la modification, ce
     * que l'appelant n'envoie pas reprend la valeur actuelle du bon.
     *
     * @param  array<string,mixed>      $campaign
     * @param  array<string,mixed>      $input
     * @param  array<string,mixed>|null $current Le bon tel que le webshop le sert.
     * @return array<string,mixed>
     */
    private function fields(AuthContext $auth, array $campaign, array $input, ?array $current): array
    {
        $has = static fn (string $key): bool => array_key_exists($key, $input);

        $mechanic = $has('mechanic') ? (string) $input['mechanic'] : ($current !== null ? self::mechanicOf($current) : '');
        if (!in_array($mechanic, self::MECHANICS, true)) {
            throw new VoucherError('Mécanique attendue : pourcentage, montant, produit offert, livraison offerte ou promotions de la campagne.');
        }

        // Promotions de l'étape Prix : relues en base au moment d'écrire — ce
        // qui part au webshop est ce que la campagne porte, pas ce que l'écran
        // en a gardé. Sans liste envoyée, une modification reprend celles que
        // le bon déclenche déjà, aux valeurs du moment.
        $promotions = null;
        if ($mechanic === 'promotions') {
            $lines  = $this->refs->campaignPromotions((int) $campaign['id']);
            $chosen = $has('promotions')
                ? $input['promotions']
                : ($current !== null ? self::chosenOf($current, $lines) : []);
            $promotions = self::promotionsPayload($chosen, $lines);
        }

        // Le produit visé : une référence du catalogue, traduite en produit ERP.
        $productId = isset($current['scopeProductId']) ? (int) $current['scopeProductId'] : null;
        $maxQty    = isset($current['scopeMaxQty']) ? (int) $current['scopeMaxQty'] : null;
        if ($has('offer_item_id')) {
            $item = $input['offer_item_id'];
            if ($item === null || $item === '' || $item === 0) {
                $productId = null;
            } else {
                $product = $this->refs->erpProduct((int) $item);
                if ($product === null) {
                    throw new VoucherError('Ce produit ne vient pas du catalogue de l\'ERP : le panier du webshop ne le reconnaîtrait pas.');
                }
                $productId = $product['erp_product_id'];
            }
        }
        if ($has('max_qty')) {
            $maxQty = self::optionalInt($input['max_qty'], 'Le plafond de pièces', 1, 99);
        }
        if ($mechanic === 'product') {
            if ($productId === null) {
                throw new VoucherError('Produit offert : choisissez le produit.');
            }
            $maxQty ??= 1;
        }
        if ($mechanic === 'free_delivery' || $mechanic === 'promotions') {
            $productId = null;
        }
        if ($productId === null) {
            $maxQty = null;
        }

        $value = null;
        if ($mechanic === 'product') {
            $value = 100.0;
        } elseif ($mechanic !== 'free_delivery' && $mechanic !== 'promotions') {
            $value = $has('value')
                ? self::optionalNumber($input['value'])
                : ($current !== null && self::mechanicOf($current) === $mechanic && isset($current['value']) ? (float) $current['value'] : null);
            if ($mechanic === 'percent' && ($value === null || $value <= 0 || $value > 100)) {
                throw new VoucherError('Une remise en pourcentage va de 1 à 100 %.');
            }
            if ($mechanic === 'fixed' && ($value === null || $value <= 0 || $value > 10000)) {
                throw new VoucherError('Une remise en euros doit être un montant positif.');
            }
        }

        $minOrder = $has('min_order') ? (self::optionalNumber($input['min_order']) ?? 0.0) : (float) ($current['minOrder'] ?? 0);
        if ($minOrder < 0 || $minOrder > 100000) {
            throw new VoucherError('La commande minimum doit être un montant positif.');
        }

        $starts = $has('starts_on')
            ? self::optionalDate($input['starts_on'], 'La date de début')
            : ($current !== null ? self::dayOf($current['startsAt'] ?? null) : self::dayOf($campaign['starts_on'] ?? null));
        $ends = $has('ends_on')
            ? self::optionalDate($input['ends_on'], 'La date de fin')
            : ($current !== null ? self::dayOf($current['expiresAt'] ?? null) : self::dayOf($campaign['ends_on'] ?? null));
        if ($starts !== null && $ends !== null && $ends < $starts) {
            throw new VoucherError('La date de fin précède la date de début.');
        }

        $usage = $has('usage_total')
            ? self::optionalInt($input['usage_total'], 'Le nombre d\'utilisations', 1, 1000000)
            : (isset($current['usageLimit']) ? (int) $current['usageLimit'] : null);
        $perCustomer = $has('per_customer')
            ? self::optionalInt($input['per_customer'], 'La limite par client', 1, 1000)
            : (isset($current['perCustomer']) ? (int) $current['perCustomer'] : null);

        $targetKind = $has('target_kind') ? strtoupper((string) $input['target_kind']) : (string) ($current['targetKind'] ?? 'NETWORK');
        $targetId   = $has('target_id')
            ? (($input['target_id'] === null || $input['target_id'] === '') ? null : (int) $input['target_id'])
            : (isset($current['targetId']) ? (int) $current['targetId'] : null);
        if (!in_array($targetKind, ['NETWORK', 'OFFICE'], true) && ($current === null || $has('target_kind'))) {
            throw new VoucherError('Pour qui : tout le monde, ou un bureau.');
        }
        if ($targetKind === 'OFFICE') {
            if (!$auth->isBrandAdmin() && ($current === null || $has('target_kind') || $has('target_id'))) {
                throw new VoucherError('Un bon réservé à un bureau se crée au niveau du réseau.', 403);
            }
            if ($targetId === null || $targetId <= 0) {
                throw new VoucherError('Choisissez le bureau à qui le bon est réservé.');
            }
        }
        if ($targetKind === 'NETWORK') {
            $targetId = null;
        }

        $promos = $promotions === null ? [] : [
            'promos'     => $promotions['promos'],
            'cumulative' => $promotions['cumulative'],
        ];

        return $promos + [
            'type'             => $mechanic === 'product' ? 'percent' : ($mechanic === 'promotions' ? 'promos' : $mechanic),
            'value'            => $value,
            'min_order'        => $minOrder,
            'max_uses'         => $usage ?? '',
            'per_customer'     => $perCustomer,
            'starts_at'        => $starts ?? '',
            'expires_at'       => $ends !== null ? $ends . ' 23:59:59' : null,
            'scope_product_id' => $productId,
            'scope_max_qty'    => $maxQty,
            'target_kind'      => $targetKind,
            'target_id'        => $targetId,
        ];
    }

    /**
     * Le bon tel que l'écran le montre. Null partout quand le webshop ne l'a
     * pas (ou n'a pas pu être lu) : l'écran le dit, il n'invente rien.
     *
     * Un bon « promotions » dit lesquelles il déclenche, rapprochées des
     * lignes de l'étape Prix ($lines) quand on les a : la ligne d'offre de
     * chacune, et si l'étape Prix a changé depuis l'envoi au webshop.
     *
     * @param  array<string,mixed>|null       $row
     * @param  list<array<string,mixed>>|null $lines
     * @return array<string,mixed>
     */
    private function describe(?array $row, ?array $lines = null): array
    {
        return self::promotionsOf($row, $lines) + [
            'found'              => $row !== null,
            'active'             => $row !== null ? (bool) ($row['active'] ?? false) : null,
            'mechanic'           => $row !== null ? self::mechanicOf($row) : null,
            'value'              => isset($row['value']) ? (float) $row['value'] : null,
            'min_order'          => $row !== null ? (float) ($row['minOrder'] ?? 0) : null,
            'scope_product_name' => $row['scopeProductName'] ?? (isset($row['scopeProductId']) ? 'produit #' . $row['scopeProductId'] : null),
            'scope_max_qty'      => isset($row['scopeMaxQty']) ? (int) $row['scopeMaxQty'] : null,
            'issuer'             => $row === null ? null : (isset($row['shopId']) ? (string) ($row['shopName'] ?? ('Boutique ' . $row['shopId'])) : 'Marque'),
            'target_kind'        => $row['targetKind'] ?? null,
            'target_label'       => $row['targetLabel'] ?? null,
            'starts_on'          => self::dayOf($row['startsAt'] ?? null),
            'ends_on'            => self::dayOf($row['expiresAt'] ?? null),
            'usage_count'        => isset($row['usageCount']) ? (int) $row['usageCount'] : null,
            'usage_limit'        => isset($row['usageLimit']) ? (int) $row['usageLimit'] : null,
            'per_customer'       => isset($row['perCustomer']) ? (int) $row['perCustomer'] : null,
        ];
    }

    /**
     * Ce qu'un bon a donné, limité aux boutiques visibles par l'appelant.
     *
     * @param  array<string,mixed>|null $usage
     * @param  list<int>|null           $shops null = toutes (la marque)
     * @return array<string,mixed>|null
     */
    private function results(?array $usage, ?array $shops): ?array
    {
        if ($usage === null) {
            return null;
        }

        $rows = array_values(array_filter(
            is_array($usage['byShop'] ?? null) ? $usage['byShop'] : [],
            static fn ($row): bool => is_array($row) && ($shops === null || (isset($row['shopId']) && in_array((int) $row['shopId'], $shops, true)))
        ));

        $byShop = array_map(static fn (array $row): array => [
            'shop_name' => (string) ($row['shopName'] ?? ('Boutique ' . ($row['shopId'] ?? '?'))),
            'orders'    => (int) ($row['orders'] ?? 0),
            'revenue'   => round((float) ($row['revenue'] ?? 0), 2),
            'discount'  => round((float) ($row['discount'] ?? 0), 2),
        ], $rows);

        return [
            'orders'   => array_sum(array_column($byShop, 'orders')),
            'revenue'  => round(array_sum(array_column($byShop, 'revenue')), 2),
            'discount' => round(array_sum(array_column($byShop, 'discount')), 2),
            'by_shop'  => $byShop,
        ];
    }

    /**
     * Les promotions d'un bon « promotions », telles que le webshop les garde.
     *
     * @param  array<string,mixed>|null       $row
     * @param  list<array<string,mixed>>|null $lines Lignes de l'étape Prix, pour le rapprochement.
     * @return array{promotions:?list<array<string,mixed>>, promotions_changed:?bool}
     */
    private static function promotionsOf(?array $row, ?array $lines): array
    {
        if ($row === null || ($row['type'] ?? null) !== 'promos' || !is_array($row['promos'] ?? null)) {
            return ['promotions' => null, 'promotions_changed' => null];
        }

        $byProduct = [];
        foreach ($lines ?? [] as $line) {
            if ($line['erp_product_id'] !== null) {
                $byProduct[$line['erp_product_id']] = $line;
            }
        }

        $changed = false;
        $list    = [];
        foreach ($row['promos'] as $promo) {
            if (!is_array($promo)) {
                continue;
            }
            $line = $byProduct[(int) ($promo['productId'] ?? 0)] ?? null;
            if ($lines !== null) {
                $now = $line !== null && self::webshopGap($line) === null ? self::webshopPromo($line) : null;
                $changed = $changed || $now === null
                    || $now['mechanic'] !== ($promo['mechanic'] ?? null)
                    || $now['percent'] != ($promo['percent'] ?? null)
                    || $now['price'] != ($promo['price'] ?? null)
                    || $now['buy'] != ($promo['buy'] ?? null)
                    || $now['get'] != ($promo['get'] ?? null)
                    || $now['maxQty'] != ($promo['maxQty'] ?? null)
                    || $line['is_cumulative'] !== (bool) ($row['cumulative'] ?? false);
            }
            $list[] = [
                'offer_item_id' => $line['offer_item_id'] ?? null,
                'product_name'  => (string) ($promo['productName'] ?? ('produit #' . ($promo['productId'] ?? '?'))),
                'mechanic'      => (string) ($promo['mechanic'] ?? ''),
                'label'         => (string) ($promo['label'] ?? ''),
            ];
        }

        return ['promotions' => $list, 'promotions_changed' => $lines === null ? null : $changed];
    }

    /**
     * Les lignes cochées, au format du webshop. Chaque ligne doit être une
     * promotion de l'étape Prix que le panier sait appliquer ; sinon le refus
     * dit laquelle et pourquoi.
     *
     * @param  mixed                     $chosen Identifiants de lignes d'offre (offer_item_id).
     * @param  list<array<string,mixed>> $lines
     * @return array{promos:list<array<string,mixed>>, cumulative:bool}
     */
    private static function promotionsPayload(mixed $chosen, array $lines): array
    {
        if (!is_array($chosen) || !array_is_list($chosen) || $chosen === []) {
            throw new VoucherError('Cochez au moins une promotion de l\'étape « Prix ».');
        }

        $byItem = [];
        foreach ($lines as $line) {
            $byItem[$line['offer_item_id']] = $line;
        }

        $promos = [];
        $cumulative = false;
        foreach (array_values(array_unique(array_map('intval', $chosen))) as $itemId) {
            $line = $byItem[$itemId] ?? null;
            if ($line === null) {
                throw new VoucherError('Une promotion cochée n\'est plus posée à l\'étape « Prix » : rechargez la liste.');
            }
            $gap = self::webshopGap($line);
            if ($gap !== null) {
                throw new VoucherError(sprintf('« %s » : %s', $line['label'], $gap));
            }
            $promos[]   = self::webshopPromo($line);
            $cumulative = $line['is_cumulative'];
        }

        return ['promos' => $promos, 'cumulative' => $cumulative];
    }

    /**
     * Une ligne de l'étape Prix au format du webshop.
     *
     * @param  array<string,mixed> $line
     * @return array{productId:int, mechanic:string, percent:?float, price:?float, buy:?int, get:?int, maxQty:?int}
     */
    private static function webshopPromo(array $line): array
    {
        return [
            'productId' => (int) $line['erp_product_id'],
            'mechanic'  => (string) $line['mechanic'],
            'percent'   => $line['mechanic'] === 'PERCENT' ? $line['discount_pct'] : null,
            'price'     => $line['mechanic'] === 'CROSSED_PRICE' ? $line['fixed_price'] : null,
            'buy'       => $line['mechanic'] === 'BUY_X_GET_Y' ? $line['buy_qty'] : null,
            'get'       => $line['mechanic'] === 'BUY_X_GET_Y' ? $line['get_qty'] : null,
            // « Quantité maximum par ticket » de l'étape Prix ; vide = sans limite.
            'maxQty'    => ($line['max_qty_per_ticket'] ?? 0) > 0 ? (int) $line['max_qty_per_ticket'] : null,
        ];
    }

    /**
     * Ce qui empêche une promotion de l'étape Prix de partir au webshop, ou
     * null si rien ne l'en empêche.
     *
     * @param array<string,mixed> $line
     */
    private static function webshopGap(array $line): ?string
    {
        if (!in_array($line['mechanic'], self::WEBSHOP_PROMOTIONS, true)) {
            return $line['mechanic'] === 'FREE_DELIVERY'
                ? 'la livraison offerte se pose comme mécanique du bon, pas comme promotion d\'un produit.'
                : sprintf('« %s » ne s\'applique pas au panier du webshop.', $line['mechanic_label'] ?? $line['mechanic']);
        }
        if ($line['erp_product_id'] === null) {
            return 'ce produit ne vient pas du catalogue de l\'ERP : le panier du webshop ne le reconnaîtrait pas.';
        }
        if ($line['mechanic'] === 'PERCENT' && (($line['discount_pct'] ?? 0) <= 0 || $line['discount_pct'] > 100)) {
            return 'le pourcentage n\'est pas saisi à l\'étape « Prix ».';
        }
        if ($line['mechanic'] === 'CROSSED_PRICE' && ($line['fixed_price'] ?? 0) <= 0) {
            return 'le prix barré n\'est pas saisi à l\'étape « Prix ».';
        }
        if ($line['mechanic'] === 'BUY_X_GET_Y' && (($line['buy_qty'] ?? 0) < 1 || ($line['get_qty'] ?? 0) < 1)) {
            return 'les quantités de l\'offre liée ne sont pas saisies à l\'étape « Prix ».';
        }

        return null;
    }

    /**
     * La valeur de la promotion en clair, comme l'étape Prix l'affiche — sans
     * le nom de la mécanique, que l'écran montre à côté (mechanic_label). Vide
     * quand la mécanique n'a pas de valeur, ou qu'elle n'est pas saisie.
     *
     * @param array<string,mixed> $line
     */
    private static function promotionText(array $line): string
    {
        $euros = static fn (?float $v): string => number_format((float) $v, 2, ',', ' ') . ' €';

        return match ($line['mechanic']) {
            'PERCENT'       => $line['discount_pct'] === null ? ''
                : '−' . rtrim(rtrim(number_format($line['discount_pct'], 2, ',', ''), '0'), ',') . ' %',
            'CROSSED_PRICE' => $line['fixed_price'] === null ? ''
                : $euros($line['fixed_price']) . ($line['baseline_price'] !== null ? ' au lieu de ' . $euros($line['baseline_price']) : ''),
            'BUNDLE_FIXED'  => $line['fixed_price'] === null ? '' : $euros($line['fixed_price']),
            'BUY_X_GET_Y'   => $line['buy_qty'] === null || $line['get_qty'] === null ? ''
                : sprintf('%d acheté%s → %d offert%s', $line['buy_qty'], $line['buy_qty'] > 1 ? 's' : '', $line['get_qty'], $line['get_qty'] > 1 ? 's' : ''),
            default         => '',
        };
    }

    /**
     * Les lignes d'offre qu'un bon « promotions » déclenche déjà, retrouvées
     * par leur produit ERP.
     *
     * @param  array<string,mixed>       $row
     * @param  list<array<string,mixed>> $lines
     * @return list<int>
     */
    private static function chosenOf(array $row, array $lines): array
    {
        $byProduct = [];
        foreach ($lines as $line) {
            if ($line['erp_product_id'] !== null) {
                $byProduct[$line['erp_product_id']] = $line['offer_item_id'];
            }
        }

        $out = [];
        foreach (is_array($row['promos'] ?? null) ? $row['promos'] : [] as $promo) {
            $item = $byProduct[(int) ($promo['productId'] ?? 0)] ?? null;
            if ($item === null) {
                throw new VoucherError(sprintf(
                    'La promotion de « %s » n\'est plus posée à l\'étape « Prix » : cochez à nouveau celles du bon.',
                    (string) ($promo['productName'] ?? 'un produit')
                ));
            }
            $out[] = $item;
        }

        return $out;
    }

    /** @param array<string,mixed> $row */
    private static function mechanicOf(array $row): string
    {
        $type = (string) ($row['type'] ?? '');
        if ($type === 'promos') {
            return 'promotions';
        }
        if ($type === 'percent' && (float) ($row['value'] ?? 0) >= 100 && isset($row['scopeProductId'])) {
            return 'product';
        }

        return in_array($type, ['percent', 'fixed', 'free_delivery'], true) ? $type : $type;
    }

    private static function dayOf(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return preg_match('/^\d{4}-\d{2}-\d{2}/', $value) === 1 ? substr($value, 0, 10) : null;
    }

    private static function optionalDate(mixed $value, string $label): ?string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return null;
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new VoucherError($label . ' doit s\'écrire AAAA-MM-JJ.');
        }

        return $value;
    }

    private static function optionalNumber(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        $normalized = str_replace(',', '.', trim((string) $value));
        if (!is_numeric($normalized)) {
            throw new VoucherError('Montant illisible : ' . (string) $value . '.');
        }

        return round((float) $normalized, 2);
    }

    private static function optionalInt(mixed $value, string $label, int $min, int $max): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (filter_var($value, FILTER_VALIDATE_INT) === false || (int) $value < $min || (int) $value > $max) {
            throw new VoucherError(sprintf('%s va de %d à %d.', $label, $min, $max));
        }

        return (int) $value;
    }
}
