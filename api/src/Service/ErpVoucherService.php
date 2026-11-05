<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\CampaignRepository;
use Marketing\Repository\CampaignVoucherRepository;
use Marketing\Repository\ErpVoucherRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\ErpClient;
use RuntimeException;

/**
 * Les bons d'une campagne, dans TFBuddy (05/11/2026) : ils valent en caisse et au webshop.
 *
 * Un bon = une campagne de bons de l'ERP rattachée à UNE promotion de l'ERP en mode VOUCHER_ONLY : la promotion
 * ne s'applique qu'avec un code de la campagne. La remise vient d'une ligne de l'étape Prix (pourcentage, prix
 * barré, offre liée) ; un prix de formule ou une livraison offerte ne se traduisent pas en promotion de l'ERP.
 *
 * L'ordre d'écriture est celui que le cockpit a éprouvé chez TFBuddy (src/promos_bons.php, essai du 24/10/2026) :
 *   1. la promotion écrite INACTIVE (mode VOUCHER_ONLY), puis relue ;
 *   2. la campagne de bons créée en brouillon (DRAFT), ses codes générés, puis rattachée à la promotion ;
 *   3. à l'activation seulement : la promotion activée, puis la campagne (PATCH /{id} — PATCH /status refuse une
 *      campagne UNIQUE), relue complète (`configuration_complete`).
 * Un refus en route laisse tout inactif : rien ne passe en caisse. Une campagne n'a pas de date de début (l'ERP
 * compare en UTC) : elle vit avec sa promotion et finit avec elle. L'ERP ne supprime pas un bon : il se suspend.
 */
final class ErpVoucherService
{
    public const MECHANICS   = ['PERCENT', 'CROSSED_PRICE', 'BUY_X_GET_Y'];
    public const CODE_TYPES  = ['SHARED', 'UNIQUE'];
    public const MAX_CODES   = 2000;
    private const BATCH      = 100;
    private const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public function __construct(
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
        private readonly CampaignVoucherRepository $refs = new CampaignVoucherRepository(),
        private readonly ErpVoucherRepository $links = new ErpVoucherRepository(),
        private readonly ?ErpClient $erp = null,
    ) {
    }

    private function erp(): ErpClient
    {
        return $this->erp ?? new ErpClient();
    }

    /**
     * Les bons de la campagne, relus dans l'ERP, et les lignes de l'étape Prix qui peuvent en devenir.
     *
     * @return array<string,mixed>
     */
    public function forCampaign(AuthContext $auth, int $campaignId): array
    {
        $campaign = $this->campaign($auth, $campaignId);
        $configured = ErpClient::isConfigured();
        $vouchers = [];
        foreach ($this->links->forCampaign($campaignId) as $link) {
            $vouchers[] = $this->describe($link, $configured);
        }

        return [
            'campaignId' => $campaignId,
            'configured' => $configured,
            'message'    => $configured ? null : ErpClient::missingConfiguration(),
            'canEdit'    => $this->writable($auth, $campaign),
            'vouchers'   => $vouchers,
            'lines'      => array_map([$this, 'lineView'], $this->refs->campaignPromotions($campaignId)),
        ];
    }

    /**
     * Crée le bon dans l'ERP. `activate` : l'active aussitôt ; sinon il reste en brouillon.
     *
     * @param  array<string,mixed> $input Validé par validate().
     * @return array<string,mixed> Le bon relu.
     */
    public function create(AuthContext $auth, int $campaignId, array $input): array
    {
        $campaign = $this->campaign($auth, $campaignId);
        if (!$this->writable($auth, $campaign)) {
            throw new VoucherError('Les bons d\'une campagne réseau se créent au niveau du réseau.', 403);
        }
        if (!ErpClient::isConfigured()) {
            throw new VoucherError(ErpClient::missingConfiguration(), 503);
        }
        $line = null;
        foreach ($this->refs->campaignPromotions($campaignId) as $l) {
            if ($l['offer_item_id'] === $input['offerItemId']) {
                $line = $l;
            }
        }
        if ($line === null) {
            throw new VoucherError('Cette ligne n\'est pas une promotion de l\'étape Prix de la campagne.', 422);
        }
        $why = $this->ineligible($line);
        if ($why !== null) {
            throw new VoucherError('« ' . $line['label'] . ' » ne devient pas un bon : ' . $why . '.', 422);
        }
        [$scope, $shopIds] = $this->shopScope($campaign);
        $until = $input['validTo'] ?? $this->dateOf($campaign['offer']['ends_on'] ?? null) ?? $this->dateOf($campaign['ends_on'] ?? null);
        $from  = $input['validFrom'] ?? $this->dateOf($campaign['offer']['starts_on'] ?? null) ?? $this->dateOf($campaign['starts_on'] ?? null);
        if ($until === null) {
            throw new VoucherError('Un bon a une date de fin : donnez-la (ou une fin à la campagne).', 422);
        }
        $name = mb_substr(trim((string) $campaign['name']) . ' — ' . $line['label'], 0, 150);
        $family = $line['mechanic'] === 'BUY_X_GET_Y' ? 'buy-x-get-y' : 'scheduled-product-discount';
        $erp = $this->erp();

        // 1. La promotion, inactive, « bon seulement ».
        $promotion = $this->promotionBody($line, $name, $scope, $shopIds, $from, $until, 'INACTIVE');
        $w = $this->write($erp, 'POST', '/api/v1/admin/promotions/' . $family, $promotion);
        $promotionId = self::idOf($w['body'], ['promotion']);
        if ($w['status'] >= 300 || $promotionId === null) {
            throw new VoucherError('L\'ERP refuse la promotion du bon : ' . self::reason($w), 422);
        }

        // 2. La campagne de bons en brouillon, ses codes, son rattachement.
        $shared = $input['codeType'] === 'SHARED' ? ($input['sharedCode'] ?? self::randomCode()) : null;
        $w = $this->write($erp, 'POST', '/api/v1/admin/voucher-campaigns', $this->campaignBody($name, $campaignId, $line, $input, $shared, $until) + ['status' => 'DRAFT']);
        $voucherId = self::idOf($w['body'], ['campaign', 'voucher_campaign']);
        if ($w['status'] >= 300 || $voucherId === null) {
            throw new VoucherError('L\'ERP refuse la campagne de bons (la promotion n° ' . $promotionId . ' reste inactive) : ' . self::reason($w), 422);
        }
        $requested = 0;
        if ($input['codeType'] === 'UNIQUE') {
            foreach ($this->codePlan($input, $campaign) as [$prefix, $count]) {
                for ($left = $count; $left > 0; $left -= self::BATCH) {
                    $w = $this->write($erp, 'POST', '/api/v1/admin/voucher-campaigns/' . $voucherId . '/codes/generate',
                        ['count' => min(self::BATCH, $left), 'length' => 8, 'prefix' => $prefix]);
                    if ($w['status'] >= 300) {
                        throw new VoucherError('Codes non générés (le bon n° ' . $voucherId . ' reste en brouillon) : ' . self::reason($w), 422);
                    }
                    $requested += min(self::BATCH, $left);
                }
            }
        }
        $w = $this->write($erp, 'PUT', '/api/v1/admin/voucher-campaigns/' . $voucherId . '/promotion',
            ['id_promotion' => $promotionId, 'confirm_activation_mode_change' => true]);
        if ($w['status'] >= 300 && $w['status'] !== 409) {
            throw new VoucherError('Le bon ne se rattache pas à sa promotion (tout reste inactif) : ' . self::reason($w), 422);
        }

        $id = $this->links->insert([
            'campaign_id' => $campaignId, 'offer_item_id' => $line['offer_item_id'], 'erp_voucher_campaign_id' => $voucherId,
            'erp_promotion_id' => $promotionId, 'promotion_family' => $family, 'name' => $name, 'code_type' => $input['codeType'],
            'shared_code' => $shared, 'codes_requested' => $requested, 'created_by' => $auth->userId,
        ]);

        // 3. L'activation, si elle est demandée.
        $link = $this->links->find($campaignId, $id) ?? [];
        if (!empty($input['activate'])) {
            $error = $this->activate($erp, $link);
            if ($error !== null) {
                $out = $this->describe($link, true);
                $out['warning'] = 'Bon créé dans l\'ERP mais pas activé : ' . $error;
                return $out;
            }
        }

        return $this->describe($link, true);
    }

    /** Active ou suspend un bon. */
    public function setStatus(AuthContext $auth, int $campaignId, int $id, string $status): array
    {
        $campaign = $this->campaign($auth, $campaignId);
        if (!$this->writable($auth, $campaign)) {
            throw new VoucherError('Les bons d\'une campagne réseau se gèrent au niveau du réseau.', 403);
        }
        $link = $this->links->find($campaignId, $id);
        if ($link === null) {
            throw new VoucherError('Bon introuvable dans cette campagne.', 404);
        }
        if (!ErpClient::isConfigured()) {
            throw new VoucherError(ErpClient::missingConfiguration(), 503);
        }
        $erp = $this->erp();
        if ($status === 'ACTIVE') {
            $error = $this->activate($erp, $link);
            if ($error !== null) {
                throw new VoucherError('Activation refusée par l\'ERP : ' . $error, 422);
            }
        } else {
            $vid = (int) $link['erp_voucher_campaign_id'];
            $w = $this->write($erp, 'PATCH', '/api/v1/admin/voucher-campaigns/' . $vid . '/status', ['status' => 'INACTIVE']);
            if ($w['status'] >= 300) {
                $w = $this->write($erp, 'PATCH', '/api/v1/admin/voucher-campaigns/' . $vid,
                    ['status' => 'INACTIVE', 'code_type' => $link['code_type'], 'shared_code' => $link['code_type'] === 'SHARED' ? $link['shared_code'] : null]);
            }
            if ($w['status'] >= 300) {
                throw new VoucherError('Suspension refusée par l\'ERP : ' . self::reason($w), 422);
            }
        }

        return $this->describe($link, true);
    }

    /**
     * Valide la demande de création (camelCase).
     *
     * @return array{input: array<string,mixed>, errors: list<array{field:string,message:string}>}
     */
    public function validate(array $body): array
    {
        $errors = [];
        $fields = ['offerItemId', 'codeType', 'sharedCode', 'count', 'perShop', 'prefix', 'validFrom', 'validTo',
            'usageLimitTotal', 'usageLimitPerCustomer', 'activate'];
        foreach (array_diff(array_keys($body), $fields) as $k) {
            $errors[] = ['field' => (string) $k, 'message' => 'Champ inconnu.'];
        }
        $in = [];
        $offer = $body['offerItemId'] ?? null;
        if (!is_int($offer) || $offer <= 0) {
            $errors[] = ['field' => 'offerItemId', 'message' => 'La ligne de l\'étape Prix (identifiant) est requise.'];
        }
        $in['offerItemId'] = is_int($offer) ? $offer : 0;
        $type = $body['codeType'] ?? 'SHARED';
        if (!in_array($type, self::CODE_TYPES, true)) {
            $errors[] = ['field' => 'codeType', 'message' => 'SHARED (un code pour tous) ou UNIQUE (des codes uniques).'];
        }
        $in['codeType'] = in_array($type, self::CODE_TYPES, true) ? $type : 'SHARED';
        $code = $body['sharedCode'] ?? null;
        if ($code !== null && $code !== '') {
            $code = strtoupper(trim((string) $code));
            if (preg_match('/^[A-Z0-9][A-Z0-9-]{3,19}$/', $code) !== 1) {
                $errors[] = ['field' => 'sharedCode', 'message' => '4 à 20 lettres, chiffres ou tirets.'];
            }
            $in['sharedCode'] = $code;
        }
        if ($in['codeType'] === 'UNIQUE') {
            $count = $body['count'] ?? null;
            if (!is_int($count) || $count < 1 || $count > self::MAX_CODES) {
                $errors[] = ['field' => 'count', 'message' => 'Nombre de codes : de 1 à ' . self::MAX_CODES . '.'];
            }
            $in['count'] = is_int($count) ? $count : 0;
            $in['perShop'] = !empty($body['perShop']);
            $prefix = strtoupper(trim((string) ($body['prefix'] ?? '')));
            if (preg_match('/^[A-Z0-9-]{0,8}$/', $prefix) !== 1) {
                $errors[] = ['field' => 'prefix', 'message' => 'Préfixe : 8 lettres, chiffres ou tirets au plus.'];
            }
            $in['prefix'] = $prefix;
        }
        foreach (['validFrom', 'validTo'] as $k) {
            $v = $body[$k] ?? null;
            if ($v === null || $v === '') {
                continue;
            }
            if (!is_string($v) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) !== 1 || !checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))) {
                $errors[] = ['field' => $k, 'message' => 'Date AAAA-MM-JJ attendue.'];
            } else {
                $in[$k] = $v;
            }
        }
        if (isset($in['validFrom'], $in['validTo']) && $in['validTo'] < $in['validFrom']) {
            $errors[] = ['field' => 'validTo', 'message' => 'La fin vient après le début.'];
        }
        foreach (['usageLimitTotal' => 1000000, 'usageLimitPerCustomer' => 1000] as $k => $max) {
            $v = $body[$k] ?? null;
            if ($v === null || $v === '') {
                continue;
            }
            if (!is_int($v) || $v < 1 || $v > $max) {
                $errors[] = ['field' => $k, 'message' => 'Entier de 1 à ' . $max . '.'];
            } else {
                $in[$k] = $v;
            }
        }
        $in['activate'] = !empty($body['activate']);

        return ['input' => $in, 'errors' => $errors];
    }

    /* --- l'ERP -------------------------------------------------------------------------------------- */

    /** @return array{status:int, body:array<mixed>} */
    private function write(ErpClient $erp, string $method, string $path, ?array $body): array
    {
        try {
            return $erp->write($method, $path, $body);
        } catch (RuntimeException $e) {
            throw new VoucherError($e->getMessage(), 502);
        }
    }

    /** Active la promotion, puis la campagne, puis relit. Rend l'erreur, ou null. */
    private function activate(ErpClient $erp, array $link): ?string
    {
        $pid = (int) ($link['erp_promotion_id'] ?? 0);
        if ($pid > 0) {
            $w = $this->write($erp, 'PATCH', '/api/v1/admin/promotions/' . $link['promotion_family'] . '/' . $pid, ['status' => 'ACTIVE']);
            if ($w['status'] >= 300) {
                return 'la promotion ne s\'active pas — ' . self::reason($w);
            }
        }
        $vid = (int) $link['erp_voucher_campaign_id'];
        $w = $this->write($erp, 'PATCH', '/api/v1/admin/voucher-campaigns/' . $vid,
            ['status' => 'ACTIVE', 'code_type' => $link['code_type'], 'shared_code' => $link['code_type'] === 'SHARED' ? $link['shared_code'] : null]);
        if ($w['status'] >= 300) {
            return 'la campagne de bons ne s\'active pas — ' . self::reason($w);
        }
        $sheet = $this->sheet($vid);
        if ($sheet === null) {
            return 'bon illisible dans l\'ERP après activation';
        }
        $c = is_array($sheet['campaign'] ?? null) ? $sheet['campaign'] : $sheet;
        if (strtoupper((string) ($c['status'] ?? '')) !== 'ACTIVE') {
            return 'bon pas relu actif';
        }
        if (array_key_exists('configuration_complete', $sheet) && !$sheet['configuration_complete']) {
            return 'bon incomplet dans l\'ERP (' . implode(', ', array_map('strval', (array) ($sheet['missing_requirements'] ?? []))) . ')';
        }

        return null;
    }

    /** La fiche d'une campagne de bons : {campaign, shared_code, redemptions_total, configuration_complete…}. */
    private function sheet(int $id): ?array
    {
        try {
            $r = $this->erp()->get('/api/v1/admin/voucher-campaigns/' . $id);
        } catch (RuntimeException $e) {
            return null;
        }
        return is_array($r['data'] ?? null) && isset($r['data']['campaign']) ? $r['data'] : $r;
    }

    /** Les codes d'une campagne de bons (200 par page, 600 au plus). @return list<array<string,mixed>> */
    private function codes(int $id): array
    {
        $out = [];
        for ($page = 1; $page <= 3; $page++) {
            try {
                $r = $this->erp()->get('/api/v1/admin/voucher-campaigns/' . $id . '/codes', ['limit' => 200, 'page' => $page]);
            } catch (RuntimeException $e) {
                break;
            }
            $items = self::items($r);
            foreach ($items as $k) {
                if (is_array($k)) {
                    $out[] = $k;
                }
            }
            $pg = $r['pagination'] ?? ($r['data']['pagination'] ?? null);
            if (count($items) < 200 || !is_array($pg) || $page >= (int) ($pg['pages'] ?? 1)) {
                break;
            }
        }
        return $out;
    }

    /** Le bon tel que l'écran le montre : lien local + ce que l'ERP en dit. */
    private function describe(array $link, bool $read): array
    {
        $out = [
            'id' => (int) $link['id'], 'name' => (string) $link['name'], 'offerItemId' => $link['offer_item_id'] !== null ? (int) $link['offer_item_id'] : null,
            'erpVoucherCampaignId' => (int) $link['erp_voucher_campaign_id'], 'erpPromotionId' => $link['erp_promotion_id'] !== null ? (int) $link['erp_promotion_id'] : null,
            'promotionFamily' => (string) $link['promotion_family'], 'codeType' => (string) $link['code_type'], 'sharedCode' => $link['shared_code'],
            'codesRequested' => (int) $link['codes_requested'], 'createdAt' => str_replace(' ', 'T', (string) $link['created_at']),
            'status' => null, 'validTo' => null, 'redemptions' => null, 'complete' => null, 'missing' => [], 'codes' => [], 'codesTotal' => null, 'readError' => null,
        ];
        if (!$read) {
            return $out;
        }
        $sheet = $this->sheet((int) $link['erp_voucher_campaign_id']);
        if ($sheet === null) {
            $out['readError'] = 'Bon illisible dans l\'ERP pour l\'instant.';
            return $out;
        }
        $c = is_array($sheet['campaign'] ?? null) ? $sheet['campaign'] : $sheet;
        $out['status'] = strtoupper((string) ($c['status'] ?? '')) ?: null;
        $out['validTo'] = isset($c['valid_to']) ? substr((string) $c['valid_to'], 0, 10) : null;
        $out['redemptions'] = isset($sheet['redemptions_total']) ? (int) $sheet['redemptions_total'] : null;
        $out['complete'] = array_key_exists('configuration_complete', $sheet) ? (bool) $sheet['configuration_complete'] : null;
        $out['missing'] = array_values(array_map('strval', (array) ($sheet['missing_requirements'] ?? [])));
        if ($link['code_type'] === 'SHARED') {
            $out['sharedCode'] = (string) ($sheet['shared_code'] ?? $c['shared_code'] ?? $link['shared_code'] ?? '');
        } else {
            $codes = $this->codes((int) $link['erp_voucher_campaign_id']);
            $out['codesTotal'] = count($codes);
            $out['codes'] = array_map(static fn ($k) => [
                'code' => (string) ($k['code'] ?? ''), 'status' => strtoupper((string) ($k['status'] ?? '')),
                'usages' => (int) ($k['usage_count'] ?? 0), 'limit' => isset($k['usage_limit']) ? (int) $k['usage_limit'] : null,
            ], $codes);
        }

        return $out;
    }

    /* --- les corps envoyés à l'ERP -------------------------------------------------------------------- */

    private function promotionBody(array $line, string $name, string $scope, array $shopIds, ?string $from, string $until, string $status): array
    {
        $common = [
            'name' => $name, 'description' => 'Bon de campagne · module Marketing', 'status' => $status, 'priority' => 100, 'is_exclusive' => false,
            'valid_from' => $from !== null ? $from . ' 00:00:00' : null, 'valid_to' => $until . ' 23:59:00',
            'shop_scope_type' => $scope, 'shop_ids' => $scope === 'SELECTED_SHOPS' ? $shopIds : [],
            'activation_mode' => 'VOUCHER_ONLY', 'schedule' => [],
        ];
        if ($line['mechanic'] === 'BUY_X_GET_Y') {
            $p = [(int) $line['erp_product_id']];
            return $common + [
                'promotion_type' => 'BUY_X_GET_Y', 'is_repeatable' => $line['max_qty_per_ticket'] === null || $line['max_qty_per_ticket'] > 1,
                'max_applications_per_transaction' => $line['max_qty_per_ticket'],
                'trigger' => ['quantity' => (int) $line['buy_qty'], 'product_ids' => $p, 'category_ids' => [], 'excluded_product_ids' => []],
                'reward' => ['quantity' => (int) $line['get_qty'], 'product_ids' => $p, 'category_ids' => [], 'excluded_product_ids' => [],
                    'type' => 'FREE', 'value' => null, 'selection_strategy' => 'CHEAPEST'],
            ];
        }

        return $common + [
            'promotion_type' => 'SCHEDULED_PRODUCT_DISCOUNT', 'is_repeatable' => true,
            'max_applications_per_transaction' => $line['max_qty_per_ticket'],
            'reward_product_ids' => [(int) $line['erp_product_id']], 'reward_category_ids' => [], 'excluded_product_ids' => [],
            'discount_type' => $line['mechanic'] === 'PERCENT' ? 'PERCENTAGE_DISCOUNT' : 'FIXED_PRICE',
            'discount_value' => $line['mechanic'] === 'PERCENT' ? (float) $line['discount_pct'] : (float) $line['fixed_price'],
        ];
    }

    private function campaignBody(string $name, int $campaignId, array $line, array $in, ?string $shared, string $until): array
    {
        $isShared = $in['codeType'] === 'SHARED';
        return [
            'name' => $name, 'description' => 'Campagne Marketing n° ' . $campaignId . ' · ' . $line['label'],
            'planned_promotion_type' => $line['mechanic'] === 'BUY_X_GET_Y' ? 'BUY_X_GET_Y' : 'SCHEDULED_PRODUCT_DISCOUNT',
            'code_type' => $in['codeType'], 'valid_from' => null, 'valid_to' => $until . ' 23:59:00',
            'usage_limit_total' => $isShared ? ($in['usageLimitTotal'] ?? null) : null,
            'usage_limit_per_code' => $isShared ? null : 1,
            'usage_limit_per_customer' => $in['usageLimitPerCustomer'] ?? null,
            'requires_customer' => false,
            'shared_code' => $shared,
        ];
    }

    /** Les lots de codes : un préfixe par boutique (3 lettres de son nom), ou le préfixe saisi. @return list<array{0:string,1:int}> */
    private function codePlan(array $in, array $campaign): array
    {
        if (empty($in['perShop'])) {
            return [[(string) ($in['prefix'] ?? ''), (int) $in['count']]];
        }
        $plan = [];
        foreach ((array) ($campaign['shops'] ?? []) as $s) {
            $p = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', iconv('UTF-8', 'ASCII//TRANSLIT', (string) $s['shop_name']) ?: '') . 'XXX', 0, 3)) . '-';
            $plan[] = [$p, (int) $in['count']];
        }
        if ($plan === []) {
            throw new VoucherError('Des codes par boutique demandent une campagne qui nomme ses boutiques.', 422);
        }
        return $plan;
    }

    /** Le périmètre de la promotion : les boutiques de la campagne, ou tout le réseau. @return array{0:string,1:list<int>} */
    private function shopScope(array $campaign): array
    {
        $shops = array_map(static fn ($s) => (int) $s['shop_id'], (array) ($campaign['shops'] ?? []));
        if ($shops === []) {
            if (($campaign['scope'] ?? '') === 'LOCALE') {
                throw new VoucherError('Cette campagne locale ne nomme pas sa boutique.', 422);
            }
            return ['ALL_SHOPS', []];
        }
        $erp = $this->refs->erpShopIds($shops);
        if (count($erp) !== count(array_unique($shops))) {
            throw new VoucherError('Une boutique de la campagne n\'est pas rapprochée de l\'ERP (reprise ERP à relancer).', 422);
        }
        return ['SELECTED_SHOPS', $erp];
    }

    /** Pourquoi une ligne de l'étape Prix ne devient pas un bon, ou null. */
    private function ineligible(array $line): ?string
    {
        if (!in_array($line['mechanic'], self::MECHANICS, true)) {
            return 'sa mécanique (« ' . $line['mechanic_label'] . ' ») n\'a pas d\'équivalent en promotion de l\'ERP';
        }
        if ($line['erp_product_id'] === null) {
            return 'elle ne vise pas un produit de l\'ERP';
        }
        if ($line['mechanic'] === 'PERCENT' && (($line['discount_pct'] ?? 0) <= 0 || $line['discount_pct'] > 100)) {
            return 'son pourcentage n\'est pas entre 0 et 100';
        }
        if ($line['mechanic'] === 'CROSSED_PRICE' && ($line['fixed_price'] ?? 0) <= 0) {
            return 'son prix barré n\'est pas saisi';
        }
        if ($line['mechanic'] === 'BUY_X_GET_Y' && (($line['buy_qty'] ?? 0) < 1 || ($line['get_qty'] ?? 0) < 1)) {
            return 'ses quantités achetée et offerte ne sont pas saisies';
        }
        return null;
    }

    private function lineView(array $line): array
    {
        $why = $this->ineligible($line);
        $what = match ($line['mechanic']) {
            'PERCENT' => '−' . rtrim(rtrim(number_format((float) $line['discount_pct'], 2, ',', ''), '0'), ',') . ' %',
            'CROSSED_PRICE' => number_format((float) $line['fixed_price'], 2, ',', '') . ' €',
            'BUY_X_GET_Y' => (int) $line['buy_qty'] . ' achetés + ' . (int) $line['get_qty'] . ' offert' . ((int) $line['get_qty'] > 1 ? 's' : ''),
            default => (string) $line['mechanic_label'],
        };
        return ['offerItemId' => $line['offer_item_id'], 'label' => $line['label'], 'mechanic' => $line['mechanic'], 'mechanicLabel' => $line['mechanic_label'],
            'summary' => $what, 'eligible' => $why === null, 'reason' => $why];
    }

    /* --- commun ----------------------------------------------------------------------------------------- */

    private function campaign(AuthContext $auth, int $id): array
    {
        $campaign = $this->campaigns->find($auth, $id);
        if ($campaign === null) {
            throw new VoucherError('Campagne introuvable.', 404);
        }
        return $campaign;
    }

    private function writable(AuthContext $auth, array $campaign): bool
    {
        return $auth->isBrandAdmin() || ($campaign['scope'] ?? null) === 'LOCALE';
    }

    private function dateOf(mixed $v): ?string
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}/', $v) === 1 ? substr($v, 0, 10) : null;
    }

    /** Le premier numéro rendu par une création, où que l'ERP le range. */
    public static function idOf(array $body, array $keys): ?int
    {
        $places = [];
        foreach ($keys as $k) {
            $places[] = $body['data'][$k] ?? null;
            $places[] = $body[$k] ?? null;
        }
        $places[] = $body['data'] ?? null;
        $places[] = $body;
        foreach ($places as $n) {
            if (is_array($n) && isset($n['id']) && is_numeric($n['id']) && (int) $n['id'] > 0) {
                return (int) $n['id'];
            }
        }
        return null;
    }

    /** @return list<mixed> */
    private static function items(array $r): array
    {
        foreach ([$r['items'] ?? null, $r['data']['items'] ?? null, $r['data'] ?? null, $r] as $n) {
            if (is_array($n) && array_is_list($n)) {
                return $n;
            }
        }
        return [];
    }

    /** Ce que l'ERP dit d'un refus. */
    private static function reason(array $w): string
    {
        $b = $w['body'];
        $msg = (string) ($b['description'] ?? $b['message'] ?? $b['error'] ?? '');
        $errs = is_array($b['errors'] ?? null) ? implode(' ; ', array_map(static fn ($v) => is_array($v) ? implode(', ', $v) : (string) $v, $b['errors'])) : '';
        return trim(($msg !== '' ? $msg : 'HTTP ' . $w['status']) . ($errs !== '' ? ' — ' . $errs : ''));
    }

    private static function randomCode(): string
    {
        $c = '';
        for ($i = 0; $i < 8; $i++) {
            $c .= self::CODE_ALPHA[random_int(0, strlen(self::CODE_ALPHA) - 1)];
        }
        return $c;
    }
}
