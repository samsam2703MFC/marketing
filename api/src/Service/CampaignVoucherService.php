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
 * Les bons d'une campagne dans l'ancien moteur du webshop — en LECTURE seule
 * depuis le 05/11/2026 : les bons se créent dans TFBuddy (ErpVoucherService) et
 * valent en caisse comme au webshop. Ceux d'avant restent visibles ici, avec ce
 * qu'ils ont rapporté. Ce qui suit décrit le moteur tel qu'il a fonctionné.
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
        $campaign = $this->campaign($auth, $campaignId);
        $lines    = $this->refs->campaignPromotions($campaignId);
        $out      = [
            'configured' => $this->webshop->isConfigured(),
            'message'    => null,
            'can_edit' => false,
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

    // ─────────────────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function campaign(AuthContext $auth, int $id): array
    {
        $campaign = $this->campaigns->find($auth, $id);
        if ($campaign === null) {
            throw new VoucherError('Campagne introuvable.', 404);
        }

        return $campaign;
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
