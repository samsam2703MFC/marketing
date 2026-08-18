<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Env;
use Marketing\Support\ErpClient;
use Marketing\Support\Scope;
use RuntimeException;
use Throwable;

/**
 * Prix de vente d'un produit : catalogue réseau, et tarif par boutique.
 *
 * L'étape « Prix » simule une promotion depuis un prix de départ. Elle
 * demandait ce prix à la main : sept produits, sept saisies, refaites à chaque
 * campagne, et l'écran affichait « à renseigner » là où la donnée existait déjà.
 *
 * Deux sources, dans cet ordre :
 *
 *   1. le **tarif de la boutique**, lu sur l'ERP —
 *      `GET /api/v1/shops/{id}/products/price-list/document` ;
 *   2. le **prix catalogue réseau**, déjà en base dans
 *      `mar_offer_item.price_amount`, repris de `product.suggested_sale_price`.
 *
 * La deuxième ne dépend de rien : elle répond même sans réseau et sans
 * configuration. La première est meilleure quand elle répond — un prix suggéré
 * n'est pas un prix pratiqué — mais elle traverse le réseau, elle peut être
 * absente, lente ou refusée, et une étape de l'assistant ne doit pas s'arrêter
 * pour autant. D'où le repli systématique, et un bloc `erp` dans la réponse qui
 * dit ce qui s'est passé plutôt que de laisser deviner d'où vient un chiffre.
 *
 * Le format rendu par l'ERP n'a pas pu être observé depuis l'environnement de
 * développement, dont la sortie réseau est fermée. Plutôt que de supposer une
 * forme, la lecture cherche ses clés — comme la reprise ERP cherche ses
 * colonnes dans `information_schema` — et rapporte celles qu'elle a retenues.
 * Une correspondance devinée qui tombe juste par hasard est plus dangereuse
 * qu'une erreur franche.
 */
final class PriceListRepository
{
    /** Clés portant l'identifiant du produit dans une ligne de tarif. */
    private const PRODUCT_KEYS = [
        'id_product', 'product_id', 'productId', 'id_produit',
        'sku', 'sku_ref', 'reference', 'code', 'product', 'id',
    ];

    /** Clés portant le prix. L'ordre compte : la première trouvée l'emporte. */
    private const PRICE_KEYS = [
        'sale_price', 'suggested_sale_price', 'selling_price', 'price_ttc',
        'gross_price', 'unit_price', 'price', 'prix', 'amount', 'value',
    ];

    /** Clés disant si le prix est TTC. */
    private const TAX_KEYS = ['includes_tax', 'tax_included', 'is_ttc', 'ttc'];

    /**
     * Réponses de l'ERP déjà obtenues pendant cette requête.
     *
     * @var array<int, array{rows: list<array{product: string, price: float,
     *                       includes_tax: ?bool}>, keys: ?array<string,string>, error: ?string}>
     */
    private array $cache = [];

    public function __construct(private readonly ErpClient $erp = new ErpClient())
    {
    }

    /**
     * Prix des produits demandés, par boutique du périmètre.
     *
     * @param  list<int> $itemIds Références `mar_offer_item`.
     * @return array<string,mixed>
     */
    public function forItems(AuthContext $auth, array $itemIds): array
    {
        $items = $this->items($itemIds);
        $shops = $this->shops($auth);

        $base     = Env::get('MAR_ERP_API_BASE');
        $template = Env::get(
            'MAR_ERP_PRICE_LIST_PATH',
            '/api/v1/shops/{shop}/products/price-list/document'
        ) ?? '';

        $erp = [
            'configured' => $base !== null && $base !== '',
            'endpoint'   => rtrim((string) $base, '/') . $template,
            'shops_read' => 0,
            'rows_read'  => 0,
            'keys'       => null,
            'errors'     => [],
        ];

        // Tarifs relevés : produit ERP → boutique → prix.
        $tariffs = [];

        foreach ($shops as $shop) {
            if ($erp['configured'] !== true || $shop['erp_shop_id'] === null) {
                continue;
            }

            $read = $this->readShop((string) $base, $template, (int) $shop['erp_shop_id']);

            if ($read['error'] !== null) {
                $erp['errors'][] = sprintf('boutique %s : %s', $shop['name'], $read['error']);
                continue;
            }

            $erp['shops_read']++;
            $erp['rows_read'] += count($read['rows']);
            $erp['keys'] ??= $read['keys'];

            foreach ($read['rows'] as $row) {
                $tariffs[$row['product']][(int) $shop['id']] = [
                    'price'        => $row['price'],
                    'includes_tax' => $row['includes_tax'],
                ];
            }
        }

        $data = array_map(function (array $item) use ($tariffs, $shops): array {
            // `sku_ref` vaut `erp-101` pour le produit 101 de l'ERP : la reprise
            // le préfixe pour ne pas confondre une référence importée avec une
            // référence saisie. Le tarif, lui, parle en identifiants ERP bruts.
            $erpId = preg_match('/^erp-(\d+)$/', (string) $item['sku_ref'], $found) === 1
                ? $found[1]
                : (string) $item['sku_ref'];

            $byShop = $tariffs[$erpId] ?? $tariffs[(string) $item['sku_ref']] ?? [];

            $prices = [];
            foreach ($shops as $shop) {
                $tariff = $byShop[(int) $shop['id']] ?? null;
                if ($tariff === null) {
                    continue;
                }

                $prices[] = [
                    'shop_id'      => (int) $shop['id'],
                    'shop_name'    => $shop['name'],
                    'price'        => $tariff['price'],
                    'includes_tax' => $tariff['includes_tax'],
                ];
            }

            $distinct = array_values(array_unique(array_column($prices, 'price')));

            return [
                'item_id'       => $item['id'],
                'sku_ref'       => $item['sku_ref'],
                'name'          => $item['name'],
                'catalog_price' => $item['price_amount'],
                'shop_prices'   => $prices,
                'distinct'      => count($distinct),
                'price'         => self::retained($prices, $item['price_amount']),
                'source'        => $prices === []
                    ? ($item['price_amount'] === null ? null : 'catalogue')
                    : 'boutiques',
            ];
        }, $items);

        return ['items' => $data, 'shops' => $shops, 'erp' => $erp];
    }

    /**
     * Prix retenu pour la simulation.
     *
     * Quand les boutiques ne s'accordent pas, c'est le prix le plus répandu qui
     * sert : une moyenne inventerait un prix que personne ne pratique, et
     * l'écart reste affiché par ailleurs pour que la dispersion se voie.
     *
     * @param list<array{price: float, ...}> $prices
     */
    private static function retained(array $prices, ?float $catalog): ?float
    {
        if ($prices === []) {
            return $catalog;
        }

        $counts = [];
        foreach ($prices as $entry) {
            $key           = (string) $entry['price'];
            $counts[$key]  = ($counts[$key] ?? 0) + 1;
        }

        arsort($counts);

        return (float) array_key_first($counts);
    }

    /**
     * Produits demandés, dans l'ordre du catalogue.
     *
     * @param  list<int> $itemIds
     * @return list<array<string,mixed>>
     */
    private function items(array $itemIds): array
    {
        if ($itemIds === []) {
            return [];
        }

        [$inSql, $bindings] = Database::inClause($itemIds, 'item');

        $statement = Database::connection()->prepare(sprintf(
            "SELECT id, sku_ref, name, detail, price_amount
               FROM mar_offer_item
              WHERE id IN (%s) AND category = 'produit'
              ORDER BY detail IS NULL, detail, name",
            $inSql
        ));
        $statement->execute($bindings);

        return array_map(static function (array $row): array {
            $row['id']           = (int) $row['id'];
            $row['price_amount'] = $row['price_amount'] === null ? null : (float) $row['price_amount'];

            return $row;
        }, $statement->fetchAll());
    }

    /**
     * Boutiques du périmètre de l'appelant.
     *
     * @return list<array<string,mixed>>
     */
    private function shops(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 's.id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT s.id, s.name, s.erp_shop_id FROM mar_shop s WHERE %s ORDER BY s.name',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map(static function (array $row): array {
            $row['id']          = (int) $row['id'];
            $row['erp_shop_id'] = $row['erp_shop_id'] === null ? null : (int) $row['erp_shop_id'];

            return $row;
        }, $statement->fetchAll());
    }

    /**
     * Tarif d'une boutique, lu sur l'ERP.
     *
     * @return array{rows: list<array{product: string, price: float, includes_tax: ?bool}>,
     *               keys: ?array<string,string>, error: ?string}
     */
    private function readShop(string $base, string $template, int $erpShopId): array
    {
        if (array_key_exists($erpShopId, $this->cache)) {
            return $this->cache[$erpShopId];
        }

        // Le client partagé porte le jeton, le délai, l'identifiant de requête
        // et la traduction des échecs. `{shop}` reste substitué ici : c'est ce
        // chemin-là qui le prévoit, pas le client.
        try {
            $decoded = $this->erp->get(str_replace('{shop}', (string) $erpShopId, $template));
        } catch (Throwable $failure) {
            return $this->cache[$erpShopId] = [
                'rows' => [], 'keys' => null, 'error' => $failure->getMessage(),
            ];
        }

        unset($base);

        return $this->cache[$erpShopId] = self::extract($decoded);
    }

    /**
     * Lignes de tarif trouvées dans une réponse, quelle que soit sa forme.
     *
     * La recherche est récursive : `{data: [...]}`, `{document: {lines: [...]}}`
     * ou un tableau nu répondent tous, sans qu'il faille parier sur l'un d'eux.
     * Est retenue toute table ayant à la fois un identifiant de produit et un
     * prix — une table de TVA ou d'entête ne les a pas, et s'écarte d'elle-même.
     *
     * @param  array<mixed> $payload
     * @return array{rows: list<array{product: string, price: float, includes_tax: ?bool}>,
     *               keys: ?array<string,string>, error: ?string}
     */
    public static function extract(array $payload): array
    {
        $rows = [];
        $keys = null;

        $walk = static function (mixed $node) use (&$walk, &$rows, &$keys): void {
            if (!is_array($node)) {
                return;
            }

            $product = self::pick($node, self::PRODUCT_KEYS);
            $price   = self::pick($node, self::PRICE_KEYS);

            if ($product !== null && $price !== null && is_numeric($price['value'])) {
                $rows[] = [
                    'product'      => (string) $product['value'],
                    'price'        => (float) $price['value'],
                    'includes_tax' => self::flag($node),
                ];
                $keys ??= ['product' => $product['key'], 'price' => $price['key']];

                // Une ligne de tarif est une feuille : descendre dedans ne
                // ferait que relire le même produit sous une autre clé.
                return;
            }

            foreach ($node as $child) {
                $walk($child);
            }
        };

        $walk($payload);

        return [
            'rows'  => $rows,
            'keys'  => $keys,
            'error' => $rows === [] ? 'aucune ligne de tarif reconnue dans la réponse' : null,
        ];
    }

    /**
     * Première clé présente, avec sa valeur.
     *
     * Un identifiant imbriqué — `{"product": {"id": 101}}` — compte aussi :
     * c'est une forme courante et la refuser rejetterait toute la ligne.
     *
     * @param  array<mixed> $node
     * @param  list<string> $candidates
     * @return array{key: string, value: mixed}|null
     */
    private static function pick(array $node, array $candidates): ?array
    {
        foreach ($candidates as $candidate) {
            if (!array_key_exists($candidate, $node)) {
                continue;
            }

            $value = $node[$candidate];

            if (is_scalar($value) && $value !== '') {
                return ['key' => $candidate, 'value' => $value];
            }

            if (is_array($value)) {
                $nested = self::pick($value, ['id', 'id_product', 'product_id', 'amount', 'value']);
                if ($nested !== null) {
                    return ['key' => $candidate . '.' . $nested['key'], 'value' => $nested['value']];
                }
            }
        }

        return null;
    }

    /** Le prix est-il TTC ? `null` quand la réponse ne le dit pas. */
    private static function flag(array $node): ?bool
    {
        foreach (self::TAX_KEYS as $key) {
            if (array_key_exists($key, $node) && is_scalar($node[$key])) {
                return filter_var($node[$key], FILTER_VALIDATE_BOOL);
            }
        }

        return null;
    }
}
