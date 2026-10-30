<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\ErpPromotionRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\ErpClient;
use RuntimeException;

/**
 * Les promotions de l'ERP, mises à la forme du module.
 *
 * La lecture brute vient de l'ERP (ErpPromotionRepository) ; ici, chaque
 * famille est ramenée à une même forme — magasins, créneaux, dates, cibles —
 * avec sa mécanique propre, les montants en centimes. Le détail d'une
 * promotion n'est décrit par le swagger de l'ERP que pour l'écriture : on lit
 * les noms de ses contrats d'écriture (`trigger` / `reward`,
 * `quantity_promotion`, `discount_type`…), et ce qui manque reste nul plutôt
 * que deviné.
 *
 * Une famille refusée (droit manquant, ERP injoignable) n'empêche pas les
 * autres : son erreur est rendue dans `sources`.
 */
final class ErpPromotionService
{
    public function __construct(
        private readonly ErpPromotionRepository $repository = new ErpPromotionRepository(),
    ) {
    }

    /**
     * @param  list<string> $families
     * @return array{rows: list<array<string,mixed>>, sources: array<string,array{ok:bool,count:int,error:?string}>}
     */
    public function list(AuthContext $auth, array $families): array
    {
        $rows = [];
        $sources = [];

        foreach ($families as $family) {
            if (!ErpClient::isConfigured()) {
                $sources[$family] = ['ok' => false, 'count' => 0, 'error' => ErpClient::missingConfiguration()];
                continue;
            }

            try {
                $read = array_map(fn (array $p): array => $this->normalize($family, $p), $this->repository->family($family));
                $read = array_values(array_filter($read, static fn (array $p): bool => $p['erpId'] > 0));
                $sources[$family] = ['ok' => true, 'count' => count($read), 'error' => null];
                array_push($rows, ...$read);
            } catch (RuntimeException $echec) {
                $sources[$family] = ['ok' => false, 'count' => 0, 'error' => $echec->getMessage()];
            }
        }

        $rows = $this->repository->visibleTo($auth, $this->withNames($rows));

        // La famille dans l'ordre du menu, les actives d'abord, puis la priorité de l'ERP.
        $rank = array_flip(array_keys(ErpPromotionRepository::FAMILIES));
        usort($rows, static fn (array $a, array $b): int => [$rank[$a['family']], $a['status'] !== 'ACTIVE', -$a['priority'], $a['name']]
            <=> [$rank[$b['family']], $b['status'] !== 'ACTIVE', -$b['priority'], $b['name']]);

        return ['rows' => $rows, 'sources' => $sources];
    }

    /** @param array<string,mixed> $p @return array<string,mixed> */
    private function normalize(string $family, array $p): array
    {
        $shopIds = self::ids($p['shop_ids'] ?? $p['shops'] ?? []);
        $scope   = strtoupper(self::text($p['shop_scope_type'] ?? null) ?? '');
        [$mechanic, $products, $categories] = $this->mechanic($family, $p);

        return [
            'id'             => $family . '-' . self::int($p['id'] ?? null),
            'family'         => $family,
            'erpId'          => self::int($p['id'] ?? null) ?? 0,
            'name'           => self::text($p['name'] ?? null) ?? '',
            'description'    => self::text($p['description'] ?? null),
            'status'         => strtoupper(self::text($p['status'] ?? null) ?? 'ACTIVE'),
            'activationMode' => self::text($p['activation_mode'] ?? null) !== null ? strtoupper((string) $p['activation_mode']) : null,
            'priority'       => self::int($p['priority'] ?? null) ?? 0,
            'shopScope'      => $family === 'voucher' || !($scope === 'SELECTED_SHOPS' || ($scope === '' && $shopIds !== [])) ? 'all' : 'selected',
            'shops'          => array_map(static fn (int $id): array => ['erpShopId' => $id, 'name' => null], $shopIds),
            'schedule'       => self::schedule($p['schedule'] ?? $p['schedules'] ?? []),
            'validFrom'      => self::day($p['valid_from'] ?? $p['date_from'] ?? $p['start_date'] ?? null),
            'validTo'        => self::day($p['valid_to'] ?? $p['date_to'] ?? $p['end_date'] ?? null),
            'mechanic'       => $mechanic,
            'products'       => $products,
            'categories'     => array_map(static fn (int $id): array => ['erpCategoryId' => $id], $categories),
        ];
    }

    /**
     * La mécanique d'une famille, ses produits et ses catégories.
     *
     * @param  array<string,mixed> $p
     * @return array{0: array<string,mixed>, 1: list<array<string,mixed>>, 2: list<int>}
     */
    private function mechanic(string $family, array $p): array
    {
        if ($family === 'bundle') {
            $bp = is_array($p['bundle_promotion'] ?? null) ? $p['bundle_promotion'] : [];
            $products = [];
            foreach (is_array($p['items'] ?? null) ? $p['items'] : [] as $item) {
                $id = self::productId($item);
                if ($id !== null) {
                    $products[] = ['erpProductId' => $id, 'name' => self::text($item['product_name'] ?? null), 'quantity' => self::num($item['quantity'] ?? null), 'role' => 'item'];
                }
            }

            return [['priceCents' => self::cents($bp['bundle_price'] ?? $p['bundle_price'] ?? null), 'currency' => 'EUR'], $products, []];
        }

        if ($family === 'buyXGetY') {
            $trigger = is_array($p['trigger'] ?? null) ? $p['trigger'] : [];
            $reward  = is_array($p['reward'] ?? null) ? $p['reward'] : [];
            $products = [
                ...array_map(static fn (int $id): array => ['erpProductId' => $id, 'name' => null, 'quantity' => null, 'role' => 'trigger'], self::productIds($trigger['product_ids'] ?? [])),
                ...array_map(static fn (int $id): array => ['erpProductId' => $id, 'name' => null, 'quantity' => null, 'role' => 'reward'], self::productIds($reward['product_ids'] ?? [])),
            ];

            return [[
                'buyQuantity' => self::int($trigger['quantity'] ?? null),
                'getQuantity' => self::int($reward['quantity'] ?? null),
                'reward'      => self::reward($reward['type'] ?? null, $reward['value'] ?? null),
            ], $products, array_values(array_unique([...self::ids($trigger['category_ids'] ?? []), ...self::ids($reward['category_ids'] ?? [])]))];
        }

        if ($family === 'quantity') {
            $q = is_array($p['quantity_promotion'] ?? null) ? $p['quantity_promotion'] : [];

            return [[
                'mechanism'    => self::text($q['mechanism_type'] ?? null),
                'quantity'     => self::int($q['bundle_quantity'] ?? null),
                'freeQuantity' => self::int($q['free_quantity'] ?? null),
            ], array_map(static fn (int $id): array => ['erpProductId' => $id, 'name' => null, 'quantity' => null, 'role' => 'eligible'], self::productIds($p['eligible_product_ids'] ?? [])),
                self::ids($p['eligible_category_ids'] ?? [])];
        }

        if ($family === 'scheduledDiscount') {
            return [[
                'reward' => self::reward($p['discount_type'] ?? null, $p['discount_value'] ?? null),
            ], array_map(static fn (int $id): array => ['erpProductId' => $id, 'name' => null, 'quantity' => null, 'role' => 'reward'], self::productIds($p['reward_product_ids'] ?? [])),
                self::ids($p['reward_category_ids'] ?? [])];
        }

        // Campagne de bons : un code partagé (qui peut s'afficher), ou des codes uniques.
        return [[
            'codeType'             => strtoupper(self::text($p['code_type'] ?? null) ?? 'SHARED'),
            'sharedCode'           => self::text($p['shared_code'] ?? null),
            'plannedPromotionType' => self::text($p['planned_promotion_type'] ?? null),
            'promotionErpId'       => self::int($p['id_promotion'] ?? (is_array($p['promotion'] ?? null) ? ($p['promotion']['id'] ?? null) : null)),
            'requiresCustomer'     => (bool) ($p['requires_customer'] ?? false),
        ], [], []];
    }

    /**
     * Les noms, lus dans le module : le nom donné par l'ERP n'est gardé que
     * s'il manque au catalogue repris.
     *
     * @param  list<array<string,mixed>> $rows
     * @return list<array<string,mixed>>
     */
    private function withNames(array $rows): array
    {
        $shopIds = $productIds = [];
        foreach ($rows as $row) {
            foreach ($row['shops'] as $shop) { $shopIds[$shop['erpShopId']] = true; }
            foreach ($row['products'] as $product) { $productIds[$product['erpProductId']] = true; }
        }

        $shops    = $this->repository->shopNames(array_keys($shopIds));
        $products = $this->repository->productNames(array_keys($productIds));

        foreach ($rows as &$row) {
            foreach ($row['shops'] as &$shop) { $shop['name'] = $shops[$shop['erpShopId']] ?? null; }
            unset($shop);
            foreach ($row['products'] as &$product) { $product['name'] = $products[$product['erpProductId']] ?? $product['name']; }
            unset($product);
        }
        unset($row);

        return $rows;
    }

    /** Une récompense : offerte, en %, montant retiré ou prix fixe (montants en centimes). */
    private static function reward(mixed $type, mixed $value): ?array
    {
        $type = strtoupper(self::text($type) ?? '');
        $v    = self::num($value);

        return match ($type) {
            'FREE'                  => ['type' => 'free', 'percent' => null, 'amountCents' => null],
            'PERCENTAGE_DISCOUNT'   => ['type' => 'percentage', 'percent' => $v, 'amountCents' => null],
            'FIXED_AMOUNT_DISCOUNT' => ['type' => 'amountOff', 'percent' => null, 'amountCents' => self::cents($v)],
            'FIXED_PRICE'           => ['type' => 'fixedPrice', 'percent' => null, 'amountCents' => self::cents($v)],
            default                 => null,
        };
    }

    /** @return list<array{dayOfWeek:int, from:string, to:string}> */
    private static function schedule(mixed $windows): array
    {
        $out = [];
        foreach (is_array($windows) ? $windows : [] as $w) {
            if (!is_array($w)) { continue; }
            $day  = self::int($w['day_of_week'] ?? null);
            $from = self::hour($w['time_from'] ?? null);
            $to   = self::hour($w['time_to'] ?? null);
            if ($day !== null && $day >= 1 && $day <= 7 && $from !== null && $to !== null) {
                $out[] = ['dayOfWeek' => $day, 'from' => $from, 'to' => $to];
            }
        }

        return $out;
    }

    /** Identifiants : des entiers, ou des objets qui en portent un. @return list<int> */
    private static function ids(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) ? $list : [] as $v) {
            $id = self::int(is_array($v) ? ($v['id'] ?? $v['id_shop'] ?? $v['shop_id'] ?? null) : $v);
            if ($id !== null && $id > 0) { $out[] = $id; }
        }

        return array_values(array_unique($out));
    }

    /** Produits visés : un entier, ou {id_product | product_id | id} (BuyXGetYProductTarget). @return list<int> */
    private static function productIds(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) ? $list : [] as $v) {
            $id = is_array($v) ? self::productId($v) : self::int($v);
            if ($id !== null && $id > 0) { $out[] = $id; }
        }

        return array_values(array_unique($out));
    }

    /** @param mixed $v */
    private static function productId($v): ?int
    {
        return is_array($v) ? self::int($v['id_product'] ?? $v['product_id'] ?? null) : null;
    }

    private static function text(mixed $v): ?string
    {
        return is_scalar($v) && trim((string) $v) !== '' ? trim((string) $v) : null;
    }

    private static function int(mixed $v): ?int
    {
        return is_numeric($v) ? (int) $v : null;
    }

    private static function num(mixed $v): ?float
    {
        return is_numeric($v) ? (float) $v : null;
    }

    private static function cents(mixed $v): ?int
    {
        return is_numeric($v) ? (int) round(((float) $v) * 100) : null;
    }

    private static function day(mixed $v): ?string
    {
        return is_string($v) && preg_match('/^(\d{4}-\d{2}-\d{2})/', $v, $m) === 1 ? $m[1] : null;
    }

    private static function hour(mixed $v): ?string
    {
        return is_string($v) && preg_match('/^(\d{1,2}):(\d{2})/', $v, $m) === 1 ? sprintf('%02d:%s', (int) $m[1], $m[2]) : null;
    }
}
