<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Allergens;
use Marketing\Support\Config;
use Marketing\Support\Database;
use Marketing\Support\Keys;
use Marketing\Support\ErpClient;
use RuntimeException;
use Throwable;

/**
 * Le catalogue du webshop, tel que TFBuddy le sert boutique par boutique : produits vendus en
 * ligne, leur catégorie, leur photo, leurs prix ; les gammes (périodes de disponibilité :
 * Noël, Saint-Nicolas…) ; les coordonnées des boutiques.
 *
 * Mêmes lectures que l'écran « Créer un post » du module Social (`api/social/src/catalogue.php`,
 * `socNavLire`, et `tfb.php`, `socApiShopNorm`), passées par le client unique de l'ERP de ce
 * module (`ErpClient`) :
 *  - `GET /api/v1/shops/{id}/products/available?webshop_active=1&alias_type=webshop
 *        &include=webshop,portions,availability_periods,webshop_availability` (FR, puis NL pour
 *    les noms) — `webshop.price_gross` = prix du webshop de la boutique, `portion_price` = son
 *    prix de vente au comptoir, `availability_periods` = ses gammes ;
 *  - `GET /api/v1/product-availability-periods?alias_type=webshop` — les gammes actives sur le webshop
 *    (swagger de l'ERP : avec `webshop`, seules les périodes dont `webshop_active` est vrai) ;
 *  - `GET /api/v1/public/shops`, à défaut `GET /api/v1/shops` — adresse, horaires, téléphone.
 *
 * Gardé quelques minutes dans `mar_catalogue_cache` (un cache, pas une copie). TFBuddy muet :
 * la dernière lecture gardée, si elle existe, et l'erreur est rendue avec elle.
 */
final class WebshopCatalogueRepository
{
    /** Catalogue d'une boutique : 30 minutes, comme Social. */
    private const TTL_PRODUCTS = 1800;

    /** Gammes et boutiques : 15 minutes. */
    private const TTL_REFERENCES = 900;

    private const INCLUDE = 'webshop,portions,availability_periods,webshop_availability';

    /** Les promotions qu'un catalogue montre (swagger de l'ERP, réalm admin). Les campagnes de bons n'y vont pas. */
    private const PROMOTION_FAMILIES = [
        'bundle'            => '/api/v1/admin/promotions/bundles',
        'buyXGetY'          => '/api/v1/admin/promotions/buy-x-get-y',
        'quantity'          => '/api/v1/admin/promotions/quantity',
        'scheduledDiscount' => '/api/v1/admin/promotions/scheduled-product-discount',
    ];

    /** Lectures déjà faites pendant la requête. @var array<string, array{data:array<mixed>, error:?string}> */
    private array $memo = [];

    /** @var null|callable(string $method, string $url, list<string> $headers, ?string $body): array{0:int,1:string} */
    private $socialTransport;

    /** Jeton du compte TFBuddy de Social, gardé le temps de la requête. */
    private ?string $socialToken = null;

    /**
     * @param null|callable(string, string, list<string>, ?string): array{0:int,1:string} $socialTransport
     *        transport HTTP de l'accès de Social (tests) ; par défaut curl.
     */
    public function __construct(private readonly ErpClient $erp = new ErpClient(), ?callable $socialTransport = null)
    {
        $this->socialTransport = $socialTransport;
    }

    /**
     * Une lecture de l'ERP : par le compte du Marketing (`MAR_ERP_API_*`), et s'il échoue (non réglé,
     * refusé), par le compte TFBuddy du module Social — celui de « Créer un post », qui lit déjà ce
     * même webshop (photos, prix des boutiques). L'erreur du premier reste dite si le second échoue aussi.
     *
     * @param array<string, string|int|null> $query
     * @return array<mixed>
     */
    private function lire(string $path, array $query = []): array
    {
        try {
            return $this->erp->get($path, $query);
        } catch (Throwable $first) {
            try {
                return $this->lireViaSocial($path, $query);
            } catch (Throwable $second) {
                throw new RuntimeException($first->getMessage() . ' (accès de Social : ' . $second->getMessage() . ')', 0, $first);
            }
        }
    }

    /**
     * @param array<string, string|int|null> $query
     * @return array<mixed>
     */
    private function lireViaSocial(string $path, array $query): array
    {
        $base = rtrim((string) (Config::value('tfb_base', 'social') ?: 'https://atelierby.tfbuddy.com/api/v1'), '/');
        $rel  = (string) preg_replace('#^/api/v\d+#', '', $path);
        $q    = array_filter($query, static fn ($v): bool => $v !== null && $v !== '');
        $url  = $base . '/' . ltrim($rel, '/') . ($q === [] ? '' : '?' . http_build_query($q));
        for ($essai = 0; $essai < 2; $essai++) {
            [$code, $body] = $this->socialHttp('GET', $url, ['Accept: application/json', 'Authorization: Bearer ' . $this->socialJeton($base, $essai > 0)], null);
            if ($code === 401 && $essai === 0) {
                continue;
            }
            if ($code < 200 || $code >= 300) {
                throw new RuntimeException('HTTP ' . $code);
            }
            $json = json_decode($body, true);
            if (!is_array($json)) {
                throw new RuntimeException('réponse illisible');
            }

            return $json;
        }
        throw new RuntimeException('HTTP 401');
    }

    private function socialJeton(string $base, bool $forcer): string
    {
        if (!$forcer && $this->socialToken !== null) {
            return $this->socialToken;
        }
        // Le jeton que Social a gardé (30 min), s'il est encore bon.
        $garde = json_decode((string) (Keys::get('tfb_jeton_admin', 'social') ?? ''), true);
        if (!$forcer && is_array($garde) && ($garde['exp'] ?? 0) > time() + 60 && is_string($garde['token'] ?? null) && $garde['token'] !== '') {
            return $this->socialToken = $garde['token'];
        }
        $phone = trim((string) (Config::value('tfb_admin_phone', 'social') ?? ''));
        $pass  = json_decode((string) (Keys::get('tfb_admin_password', 'social') ?? ''), true);
        if ($phone === '' || !is_string($pass) || $pass === '') {
            throw new RuntimeException('compte TFBuddy de Social non renseigné');
        }
        [$code, $body] = $this->socialHttp('POST', $base . '/admin/auth/login', ['Accept: application/json', 'Content-Type: application/json'], (string) json_encode(['phone' => $phone, 'password' => $pass]));
        $j = json_decode($body, true);
        $j = is_array($j) ? $j : [];
        foreach ([$j['access_token'] ?? null, $j['token'] ?? null, $j['data']['access_token'] ?? null, $j['data']['token'] ?? null] as $t) {
            if (is_string($t) && $t !== '') {
                return $this->socialToken = $t;
            }
        }
        throw new RuntimeException('connexion refusée (HTTP ' . $code . ')');
    }

    /** @return array{0:int,1:string} */
    private function socialHttp(string $method, string $url, array $headers, ?string $body): array
    {
        if ($this->socialTransport !== null) {
            return ($this->socialTransport)($method, $url, $headers, $body);
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $r = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return [$r === false ? 0 : $code, $r === false ? '' : (string) $r];
    }

    /**
     * Les produits du webshop d'une boutique (identifiant de caisse ERP).
     *
     * @return array{products: list<array{id:int, name:string, nameNl:string, image:?string, categoryId:?int,
     *               categoryName:string, categoryNameNl:string, groupId:?int, gammes:list<int>,
     *               webPrice:?float, shopPrice:?float}>, error: ?string, readAt: ?string}
     */
    public function products(int $erpShopId): array
    {
        $read = $this->cached('produits:' . $erpShopId, self::TTL_PRODUCTS, function () use ($erpShopId): array {
            $query = ['webshop_active' => 1, 'alias_type' => 'webshop', 'include' => self::INCLUDE];
            $fr = ErpClient::rows($this->lire('/api/v1/shops/' . $erpShopId . '/products/available', ['lang_code' => 'fr'] + $query));
            $nl = [];
            $nlCats = [];
            try {
                foreach (ErpClient::rows($this->lire('/api/v1/shops/' . $erpShopId . '/products/available', ['lang_code' => 'nl'] + $query)) as $row) {
                    $nl[(string) ($row['id'] ?? '')] = trim((string) ($row['name'] ?? ''));
                    $cat = is_array($row['category'] ?? null) ? $row['category'] : [];
                    $catId = (int) ($row['id_category'] ?? ($cat['id'] ?? 0));
                    if ($catId > 0) {
                        $nlCats[$catId] = trim((string) ($cat['name'] ?? $row['category_name'] ?? ''));
                    }
                }
            } catch (Throwable) {
                // Sans les noms néerlandais : le français les remplace, et l'écran le dit.
            }

            $products = [];
            foreach ($fr as $row) {
                if (empty($row['id']) || empty($row['is_active'])) {
                    continue;
                }
                $cat     = is_array($row['category'] ?? null) ? $row['category'] : [];
                $catId   = (int) ($row['id_category'] ?? ($cat['id'] ?? 0));
                $catName = trim((string) ($cat['name'] ?? $row['category_name'] ?? ''));
                // Les cartons et formats des professionnels ne vont pas dans un catalogue de clients.
                if (preg_match('/^b\.?\s?2\.?\s?b\b/i', $catName) === 1) {
                    continue;
                }
                $group  = is_array($cat['groups'][0] ?? null) ? $cat['groups'][0] : null;
                $gammes = [];
                $periods = [];
                foreach ((array) ($row['availability_periods'] ?? []) as $period) {
                    if (is_array($period) && !empty($period['id'])) {
                        $gammes[] = (int) $period['id'];
                        // Les dates de la période quand la ligne les porte (`from_md`/`to_md`, sinon
                        // `start_date`/`end_date`) ; à défaut, celles de la gamme (`gammes()`).
                        $periods[(int) $period['id']] = ['id' => (int) $period['id'], 'from' => self::dayMonth($period, 'from_md', 'start_date'), 'to' => self::dayMonth($period, 'to_md', 'end_date')];
                    }
                }
                // Délai de préparation du produit (colonne `preparation_lead_time_hours` de l'ERP) : 0 ou absent = rien.
                $lead = is_numeric($row['preparation_lead_time_hours'] ?? null) && (float) $row['preparation_lead_time_hours'] > 0
                    ? (int) round((float) $row['preparation_lead_time_hours']) : null;
                $name = trim((string) ($row['name'] ?? ''));
                $products[] = [
                    'id'             => (int) $row['id'],
                    'name'           => $name,
                    'nameNl'         => ($nl[(string) $row['id']] ?? '') !== '' ? $nl[(string) $row['id']] : $name,
                    'image'          => self::image($row['webshop_image'] ?? null),
                    'categoryId'     => $catId > 0 ? $catId : null,
                    'categoryName'   => $catName,
                    'categoryNameNl' => ($nlCats[$catId] ?? '') !== '' ? $nlCats[$catId] : $catName,
                    'groupId'        => $group !== null && !empty($group['id']) ? (int) $group['id'] : null,
                    'gammes'         => array_values(array_unique($gammes)),
                    'webPrice'       => is_numeric($row['webshop']['price_gross'] ?? null) ? round((float) $row['webshop']['price_gross'], 2) : null,
                    'shopPrice'      => is_numeric($row['portion_price'] ?? null) ? round((float) $row['portion_price'], 2) : null,
                    'periods'        => array_values($periods),
                    'leadHours'      => $lead,
                    // Le poids d'une pièce et les allergènes de la recette (17/11/2026, obligatoires au catalogue imprimé).
                    'weightGrams'    => Allergens::weightGrams($row['single_weight'] ?? null, $name),
                    'allergens'      => Allergens::fromText(is_string($row['grouped_allergens'] ?? null) ? $row['grouped_allergens'] : null),
                ];
            }

            return $products;
        });

        // Le webshop de la boutique muet ou vide : le catalogue du Marketing (repris de l'ERP, le même que
        // l'assistant de campagne) donne les produits, leurs gammes et leur prix. Le webshop lu, il
        // complète seulement les gammes qu'il ne rend pas.
        $local = $this->localProducts();
        if ($read['data'] === [] && $local !== []) {
            // L'erreur de l'ERP reste dite (l'écran montre pourquoi le webshop n'a pas répondu).
            return ['products' => $local, 'error' => $read['error'] !== null ? $read['error'] . ' — produits repris du catalogue du Marketing.' : null, 'readAt' => $read['readAt'], 'source' => 'catalogue'];
        }
        if ($local !== []) {
            $gammesById = [];
            foreach ($local as $p) {
                $gammesById[$p['id']] = $p['gammes'];
            }
            foreach ($read['data'] as &$p) {
                if (($p['gammes'] ?? []) === [] && isset($gammesById[$p['id']])) {
                    $p['gammes'] = $gammesById[$p['id']];
                }
            }
            unset($p);
        }

        return ['products' => $read['data'], 'error' => $read['error'], 'readAt' => $read['readAt']];
    }

    /**
     * Le catalogue du Marketing (`mar_offer_item`, repris de l'ERP par la synchronisation : produits
     * `erp-<id>`, gammes `erp-saison-<id>` et leurs liens `mar_offer_item_season`). L'identifiant d'un
     * produit est son id ERP, celui d'une gamme l'id de sa période : les mêmes que le webshop.
     *
     * @return list<array{id:int, name:string, nameNl:string, image:?string, categoryId:?int, categoryName:string,
     *              categoryNameNl:string, groupId:?int, gammes:list<int>, webPrice:?float, shopPrice:?float}>
     */
    public function localProducts(): array
    {
        try {
            $db = Database::connection();
            $saisons = [];
            foreach ($db->query("SELECT id, sku_ref FROM mar_offer_item WHERE category = 'saison' AND sku_ref LIKE 'erp-saison-%'")->fetchAll() as $row) {
                $saisons[(int) $row['id']] = (int) substr((string) $row['sku_ref'], strlen('erp-saison-'));
            }
            $liens = [];
            foreach ($db->query('SELECT item_id, season_item_id FROM mar_offer_item_season')->fetchAll() as $row) {
                if (isset($saisons[(int) $row['season_item_id']])) {
                    $liens[(int) $row['item_id']][] = $saisons[(int) $row['season_item_id']];
                }
            }
            $out = [];
            foreach ($db->query(
                "SELECT id, sku_ref, name, detail, price_amount, image_url FROM mar_offer_item
                  WHERE category = 'produit' AND is_active = 1 AND sku_ref REGEXP '^erp-[0-9]+$'
                  ORDER BY detail, name"
            )->fetchAll() as $row) {
                $famille = trim((string) ($row['detail'] ?? ''));
                if (preg_match('/^b\.?\s?2\.?\s?b\b/i', $famille) === 1) {
                    continue;
                }
                $image = trim((string) ($row['image_url'] ?? ''));
                $out[] = [
                    'id'             => (int) substr((string) $row['sku_ref'], 4),
                    'name'           => (string) $row['name'],
                    'nameNl'         => (string) $row['name'],
                    'image'          => preg_match('#^https?://#', $image) === 1 ? $image : null,
                    'categoryId'     => $famille !== '' ? (int) sprintf('%u', crc32($famille)) % 1000000000 : null,
                    'categoryName'   => $famille !== '' ? $famille : 'Autres',
                    'categoryNameNl' => $famille !== '' ? $famille : 'Overige',
                    'groupId'        => null,
                    'gammes'         => array_values(array_unique($liens[(int) $row['id']] ?? [])),
                    'webPrice'       => $row['price_amount'] === null ? null : round((float) $row['price_amount'], 2),
                    'shopPrice'      => null,
                ];
            }

            return $out;
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * Les gammes actives (périodes de disponibilité de TFBuddy).
     *
     * @return array{gammes: list<array{id:int, name:string, image:?string, from:?string, to:?string}>, error:?string}
     */
    public function gammes(): array
    {
        $read = $this->cached('gammes', self::TTL_REFERENCES, function (): array {
            $out = [];
            foreach (ErpClient::rows($this->lire('/api/v1/product-availability-periods', ['lang_code' => 'fr', 'alias_type' => 'webshop'])) as $row) {
                if (empty($row['id']) || empty($row['is_active'])) {
                    continue;
                }
                // « 🎄 Gamme Noël » → « Gamme Noël » : un emoji en tête ne s'imprime pas.
                $name = trim((string) preg_replace('/^[^\p{L}\p{N}]+/u', '', (string) ($row['name'] ?? '')));
                $out[] = [
                    'id'    => (int) $row['id'],
                    'name'  => $name,
                    'image' => self::image($row['photo'] ?? null),
                    'from'  => self::dayMonth($row, 'from_md', 'start_date'),
                    'to'    => self::dayMonth($row, 'to_md', 'end_date'),
                ];
            }
            usort($out, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

            return $out;
        });

        // TFBuddy muet ou sans période active : les gammes saisonnières du catalogue du Marketing.
        if ($read['data'] === []) {
            try {
                $local = [];
                foreach (Database::connection()->query(
                    "SELECT sku_ref, name, image_url FROM mar_offer_item
                      WHERE category = 'saison' AND is_active = 1 AND sku_ref LIKE 'erp-saison-%' ORDER BY name"
                )->fetchAll() as $row) {
                    $image = trim((string) ($row['image_url'] ?? ''));
                    $local[] = [
                        'id'    => (int) substr((string) $row['sku_ref'], strlen('erp-saison-')),
                        'name'  => trim((string) preg_replace('/^[^\p{L}\p{N}]+/u', '', (string) $row['name'])),
                        'image' => preg_match('#^https?://#', $image) === 1 ? $image : null,
                        'from'  => null,
                        'to'    => null,
                    ];
                }
                if ($local !== []) {
                    return ['gammes' => $local, 'error' => null];
                }
            } catch (Throwable) {
                // rien de plus à proposer : l'erreur de TFBuddy reste dite
            }
        }

        return ['gammes' => $read['data'], 'error' => $read['error']];
    }

    /**
     * Coordonnées d'une boutique : nom, adresse, horaires, téléphone. `null` si TFBuddy ne la connaît pas.
     *
     * @return array{shop: ?array{erpShopId:int, name:string, address:string, hours:string, hoursNl:string, phone:string}, error:?string}
     */
    public function shop(int $erpShopId): array
    {
        $read = $this->cached('boutiques', self::TTL_REFERENCES, function (): array {
            $rows = [];
            $errors = [];
            foreach (['/api/v1/public/shops', '/api/v1/shops'] as $path) {
                try {
                    foreach (ErpClient::rows($this->lire($path), ['shops']) as $row) {
                        if (!isset($row['id'])) {
                            continue;
                        }
                        $norm = self::shopRow($row);
                        $prev = $rows[$norm['erpShopId']] ?? null;
                        // La route publique prime là où elle a une valeur ; l'autre complète.
                        $rows[$norm['erpShopId']] = $prev === null ? $norm : array_replace($norm, array_filter($prev, static fn ($v): bool => $v !== ''));
                    }
                } catch (Throwable $e) {
                    $errors[] = $e->getMessage();
                }
            }
            if ($rows === [] && $errors !== []) {
                throw new RuntimeException($errors[0]);
            }

            return array_values($rows);
        });

        foreach ($read['data'] as $row) {
            if ((int) $row['erpShopId'] === $erpShopId) {
                return ['shop' => $row, 'error' => $read['error']];
            }
        }

        return ['shop' => null, 'error' => $read['error']];
    }

    /** @return array{erpShopId:int, name:string, address:string, hours:string, hoursNl:string, phone:string} */
    private static function shopRow(array $row): array
    {
        $full  = trim((string) ($row['representative_name'] ?? $row['name'] ?? ''));
        $city  = trim((string) ($row['city'] ?? ''));
        $short = $city !== '' ? $city : (preg_match('/-\s*([^-]+)$/', $full, $m) === 1 ? trim($m[1]) : $full);
        $street = trim(trim((string) ($row['street'] ?? '')) . ' ' . trim((string) ($row['street_num'] ?? '')));
        $address = trim(implode(', ', array_filter([$street, trim(($row['zip'] ?? '') . ' ' . $city)])), ', ');
        $open  = trim((string) ($row['opening_hours'] ?? ''));
        $close = trim((string) ($row['closing_hours'] ?? ''));
        $h = static fn (string $x): string => (string) preg_replace('/^0?(\d{1,2}):(\d{2}).*$/', '$1h$2', $x);
        $hours = $open !== '' && $close !== '' ? $h($open) . '–' . $h($close) : '';

        return [
            'erpShopId' => (int) $row['id'],
            'name'      => $short,
            'address'   => $address,
            'hours'     => $hours,
            'hoursNl'   => str_replace('h', 'u', $hours),
            'phone'     => trim((string) ($row['phone'] ?? '')),
        ];
    }

    /**
     * Le jour et le mois d'une période, « JJ/MM » : `from_md` / `to_md` (MMJJ, ex. 1201 = 1er décembre), sinon la
     * date `start_date` / `end_date`. Rien de lisible : null.
     */
    private static function dayMonth(array $row, string $md, string $date): ?string
    {
        if (is_numeric($row[$md] ?? null) && (int) $row[$md] >= 101 && (int) $row[$md] <= 1231) {
            return sprintf('%02d/%02d', (int) $row[$md] % 100, intdiv((int) $row[$md], 100));
        }
        if (is_string($row[$date] ?? null) && preg_match('/^\d{4}-(\d{2})-(\d{2})/', $row[$date], $m) === 1) {
            return $m[2] . '/' . $m[1];
        }

        return null;
    }

    /**
     * Les promotions de TFBuddy qu'un catalogue peut montrer : bundles, « X achetés = Y », promotions de quantité,
     * remises programmées — les ACTIVES (`status=ACTIVE`), liste puis fiche de chacune (la liste ne porte que des
     * compteurs), mises à la forme du module par `ErpPromotionService::normalize`. Mêmes chemins que les autres
     * lectures (compte du Marketing, sinon celui de Social). Une famille illisible n'empêche pas les autres : son
     * erreur est rendue dans `errors`. Gardé 15 minutes.
     *
     * @return array{offers: list<array<string,mixed>>, errors: array<string,string>, error: ?string}
     */
    public function promotions(): array
    {
        $read = $this->cached('promotions', self::TTL_REFERENCES, function (): array {
            $normalizer = new \Marketing\Service\ErpPromotionService();
            $offers = [];
            $errors = [];
            foreach (self::PROMOTION_FAMILIES as $family => $path) {
                try {
                    $rows = [];
                    for ($page = 1; $page <= 10; $page++) {
                        $payload = $this->lire($path, ['status' => 'ACTIVE', 'limit' => 100, 'page' => $page]);
                        $items = ErpClient::rows($payload, ['items']);
                        array_push($rows, ...$items);
                        $pagination = $payload['pagination'] ?? ($payload['data']['pagination'] ?? null);
                        $pages = is_array($pagination) ? (int) ($pagination['pages'] ?? 0) : 0;
                        if ($items === [] || ($pages > 0 ? $page >= $pages : count($items) < 100)) {
                            break;
                        }
                    }
                    foreach ($rows as $row) {
                        if (!isset($row['id'])) {
                            continue;
                        }
                        try {
                            $full = ErpClient::rows($this->lire($path . '/' . rawurlencode((string) $row['id'])));
                            if ($full !== []) {
                                $row = array_merge($row, $full[0]);
                            }
                        } catch (Throwable) {
                            // La fiche illisible : la ligne de la liste, sans sa composition.
                        }
                        $offer = $normalizer->normalize($family, $row);
                        if ($offer['erpId'] > 0) {
                            $offers[] = $offer;
                        }
                    }
                } catch (Throwable $e) {
                    $errors[$family] = $e->getMessage();
                }
            }
            if ($offers === [] && count($errors) === count(self::PROMOTION_FAMILIES)) {
                throw new RuntimeException((string) reset($errors));
            }

            return ['offers' => $offers, 'errors' => $errors];
        });

        return ['offers' => $read['data']['offers'] ?? [], 'errors' => $read['data']['errors'] ?? [], 'error' => $read['error']];
    }

    /**
     * Les remises programmées actives d'une boutique (`GET /shops/{id}/scheduled-product-discounts/active`) : leurs
     * identifiants. La réponse n'est pas décrite par le swagger : une ligne porte `id_promotion`, `promotion_id` ou
     * son `id`. Illisible : `ids` null (la liste du réseau, filtrée par ses dates et ses boutiques, fait foi).
     *
     * @return array{ids: ?list<int>, error: ?string}
     */
    public function activeScheduledDiscounts(int $erpShopId): array
    {
        $read = $this->cached('remises-actives:' . $erpShopId, self::TTL_REFERENCES, function () use ($erpShopId): array {
            $ids = [];
            foreach (ErpClient::rows($this->lire('/api/v1/shops/' . $erpShopId . '/scheduled-product-discounts/active'), ['items']) as $row) {
                $id = $row['id_promotion'] ?? $row['promotion_id'] ?? (is_array($row['promotion'] ?? null) ? ($row['promotion']['id'] ?? null) : null) ?? $row['id'] ?? null;
                if (is_numeric($id) && (int) $id > 0) {
                    $ids[] = (int) $id;
                }
            }

            return ['ids' => array_values(array_unique($ids))];
        });

        return ['ids' => $read['error'] !== null && $read['readAt'] === null ? null : ($read['data']['ids'] ?? null), 'error' => $read['error']];
    }

    private static function image(mixed $value): ?string
    {
        $url = is_array($value) ? (string) ($value['url'] ?? '') : '';

        return preg_match('#^https://#', $url) === 1 ? $url : null;
    }

    /**
     * Une lecture gardée : en mémoire pour la requête, en base pour quelques minutes. En échec,
     * la dernière lecture gardée revient avec l'erreur ; sans elle, une liste vide et l'erreur.
     *
     * @param callable(): array<mixed> $read
     * @return array{data: array<mixed>, error: ?string, readAt: ?string}
     */
    private function cached(string $key, int $ttl, callable $read): array
    {
        if (isset($this->memo[$key])) {
            return $this->memo[$key];
        }

        $row = null;
        try {
            $statement = Database::connection()->prepare('SELECT payload, read_at FROM mar_catalogue_cache WHERE cle = :cle');
            $statement->execute(['cle' => $key]);
            $row = $statement->fetch() ?: null;
        } catch (Throwable) {
            $row = null;
        }

        $fresh = $row !== null && strtotime((string) $row['read_at'] . ' UTC') >= time() - $ttl;
        if ($fresh) {
            $data = json_decode((string) $row['payload'], true);
            if (is_array($data)) {
                return $this->memo[$key] = ['data' => $data, 'error' => null, 'readAt' => gmdate('c', (int) strtotime((string) $row['read_at'] . ' UTC'))];
            }
        }

        try {
            $data = $read();
            $now  = gmdate('Y-m-d H:i:s');
            $save = Database::connection()->prepare(
                'INSERT INTO mar_catalogue_cache (cle, payload, read_at) VALUES (:cle, :payload, :read_at)
                 ON DUPLICATE KEY UPDATE payload = VALUES(payload), read_at = VALUES(read_at)'
            );
            $save->execute(['cle' => $key, 'payload' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'read_at' => $now]);

            return $this->memo[$key] = ['data' => $data, 'error' => null, 'readAt' => gmdate('c', (int) strtotime($now . ' UTC'))];
        } catch (Throwable $e) {
            $old = $row !== null ? json_decode((string) $row['payload'], true) : null;

            return $this->memo[$key] = [
                'data'   => is_array($old) ? $old : [],
                'error'  => $e->getMessage(),
                'readAt' => is_array($old) ? gmdate('c', (int) strtotime((string) $row['read_at'] . ' UTC')) : null,
            ];
        }
    }

    /** Oublie les lectures (tests). */
    public static function purge(): void
    {
        Database::connection()->exec('DELETE FROM mar_catalogue_cache');
    }
}
