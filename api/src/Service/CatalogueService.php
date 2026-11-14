<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\CatalogueRepository;
use Marketing\Repository\WebshopCatalogueRepository;
use Marketing\Support\Config;
use Marketing\Support\Keys;

/**
 * Les catalogues produits : règles, contraintes et composition.
 *
 * Un catalogue = une couverture et une dernière page fixées par la Charte des catalogues de la
 * marque (verrouillées), et des pages intérieures remplies par catégorie du webshop, chacune dans
 * l'une des trois mises en page (`vedette` 1 + 4, `grille` 2 × 3, `liste` avec prix). Les produits,
 * leurs photos et leurs prix viennent du webshop (TFBuddy), relus à chaque composition : rien
 * n'est saisi à la main, aucun prix n'est inventé.
 *
 * Deux propriétaires :
 *  - la marque (écran « Catalogues » du Marketing) : une version générale et, au choix, une
 *    version par boutique (prix de SA boutique, son QR, son adresse) ;
 *  - une boutique (dashboard magasin, par l'API de service) : ses produits seulement, à ses prix,
 *    couverture et dernière page de la charte, trois mises en page — contraintes appliquées ICI,
 *    quoi que le client envoie.
 */
final class CatalogueService
{
    public const OWNERS   = ['marque', 'boutique'];
    public const SOURCES  = ['gamme', 'campagne', 'choix'];
    public const FORMATS  = ['A5', 'A4'];
    public const STATUSES = ['brouillon', 'pret', 'imprime'];
    public const LANGS    = ['fr', 'nl'];

    /** Mise en page → nombre de produits qu'une page porte. */
    public const LAYOUTS = ['vedette' => 5, 'grille' => 6, 'liste' => 12];

    private const TITLE_MAX    = 160;
    private const PRODUCTS_MAX = 400;
    private const PAGES_MAX    = 40;
    private const TEXT_MAX     = 240;
    private const SHOPS_MAX    = 100;

    /** Validité d'un lien d'impression, en secondes. */
    private const PRINT_TTL = 172800;

    /** La charte telle qu'elle vit dans `mar_variable`. */
    public const CHARTER_VARIABLE = 'catalogues.charte';

    public function __construct(
        private readonly CatalogueRepository $catalogues = new CatalogueRepository(),
        private readonly WebshopCatalogueRepository $webshop = new WebshopCatalogueRepository(),
        private readonly MediaService $media = new MediaService(),
    ) {
    }

    // ---------------------------------------------------------------------------------------------
    // Produits du webshop
    // ---------------------------------------------------------------------------------------------

    /**
     * Les produits du webshop des boutiques données, réunis par produit : nom FR/NL, photo,
     * catégorie, gammes, et le prix de chaque boutique qui le vend. Un produit absent d'une
     * boutique n'a pas de prix pour elle.
     *
     * @param list<array{id:int, name:string, erpShopId:?int}> $shops
     * @return array<string,mixed>
     */
    public function webshopProducts(array $shops): array
    {
        $byId = [];
        $categories = [];
        $read = [];
        foreach ($shops as $shop) {
            if ($shop['erpShopId'] === null) {
                $read[] = ['id' => $shop['id'], 'erpShopId' => null, 'name' => $shop['name'], 'products' => 0, 'error' => 'Boutique sans identifiant de caisse : pas de webshop.', 'readAt' => null];
                continue;
            }
            $result = $this->webshop->products($shop['erpShopId']);
            $read[] = ['id' => $shop['id'], 'erpShopId' => $shop['erpShopId'], 'name' => $shop['name'], 'products' => count($result['products']), 'error' => $result['error'], 'readAt' => $result['readAt']];
            foreach ($result['products'] as $product) {
                $id = (int) $product['id'];
                if (!isset($byId[$id])) {
                    $byId[$id] = [
                        'id'         => $id,
                        'name'       => $product['name'],
                        'nameNl'     => $product['nameNl'],
                        'imageUrl'   => $product['image'],
                        'categoryId' => $product['categoryId'],
                        'gammes'     => $product['gammes'],
                        'prices'     => [],
                    ];
                }
                $byId[$id]['gammes'] = array_values(array_unique(array_merge($byId[$id]['gammes'], $product['gammes'])));
                $byId[$id]['imageUrl'] ??= $product['image'];
                $byId[$id]['prices'][] = [
                    'shopId'         => $shop['id'],
                    'webPriceCents'  => self::cents($product['webPrice']),
                    'shopPriceCents' => self::cents($product['shopPrice']),
                ];
                if ($product['categoryId'] !== null && !isset($categories[$product['categoryId']])) {
                    $categories[$product['categoryId']] = ['id' => $product['categoryId'], 'name' => $product['categoryName'], 'nameNl' => $product['categoryNameNl']];
                }
            }
        }

        // Aucune boutique lisible (pas d'identifiant de caisse, webshop muet) : le catalogue du Marketing,
        // repris de l'ERP, donne les produits, leurs gammes et leur prix de référence.
        if ($byId === []) {
            foreach ($this->webshop->localProducts() as $product) {
                $id = (int) $product['id'];
                $byId[$id] = [
                    'id'         => $id,
                    'name'       => $product['name'],
                    'nameNl'     => $product['nameNl'],
                    'imageUrl'   => $product['image'],
                    'categoryId' => $product['categoryId'],
                    'gammes'     => $product['gammes'],
                    'prices'     => [],
                    'refPriceCents' => self::cents($product['webPrice']),
                ];
                if ($product['categoryId'] !== null && !isset($categories[$product['categoryId']])) {
                    $categories[$product['categoryId']] = ['id' => $product['categoryId'], 'name' => $product['categoryName'], 'nameNl' => $product['categoryNameNl']];
                }
            }
        }

        $products = array_values($byId);
        foreach ($products as &$product) {
            [$price, $differs] = self::generalPrice($product['prices']);
            if ($price === null && isset($product['refPriceCents'])) {
                $price = $product['refPriceCents'];
            }
            unset($product['refPriceCents']);
            $product['priceCents'] = $price;
            $product['priceDiffers'] = $differs;
        }
        unset($product);

        $categoryOrder = array_values($categories);
        usort($categoryOrder, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));
        usort($products, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return [
            'products'   => $products,
            'categories' => $categoryOrder,
            'gammes'     => $this->webshop->gammes()['gammes'],
            'shops'      => $read,
        ];
    }

    /**
     * Le prix « général » d'un produit : le prix du webshop le plus répandu parmi les boutiques
     * qui le vendent (à défaut leur prix au comptoir), et la liste des boutiques qui en ont un autre.
     *
     * @param list<array{shopId:int, webPriceCents:?int, shopPriceCents:?int}> $prices
     * @return array{0:?int, 1:list<int>}
     */
    private static function generalPrice(array $prices): array
    {
        $count = [];
        foreach ($prices as $price) {
            $value = $price['webPriceCents'] ?? $price['shopPriceCents'];
            if ($value !== null) {
                $count[$value] = ($count[$value] ?? 0) + 1;
            }
        }
        if ($count === []) {
            return [null, []];
        }
        arsort($count);
        $general = (int) array_key_first($count);
        $differs = [];
        foreach ($prices as $price) {
            $value = $price['webPriceCents'] ?? $price['shopPriceCents'];
            if ($value !== null && $value !== $general) {
                $differs[] = $price['shopId'];
            }
        }

        return [$general, $differs];
    }

    private static function cents(?float $amount): ?int
    {
        return $amount === null ? null : (int) round($amount * 100);
    }

    /**
     * Les boutiques dont un catalogue lit les produits : la sienne pour une boutique ; pour la
     * marque, celles de ses versions, sinon tout le réseau de caisse.
     *
     * @return list<array{id:int, name:string, erpShopId:?int}>
     */
    private function shopsOf(array $row): array
    {
        if ($row['owner'] === 'boutique') {
            return $this->catalogues->shops([(int) $row['shop_id']]);
        }
        $ids = array_map('intval', $row['settings']['shopIds'] ?? []);

        return $this->catalogues->shops($ids);
    }

    // ---------------------------------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------------------------------

    /** @return array{items: list<array<string,mixed>>, total:int} */
    public function page(array $filters, string $sort, bool $descending, int $page, int $perPage, ?int $shopId = null): array
    {
        $result = $this->catalogues->page($filters, $sort, $descending, $page, $perPage, $shopId);

        return ['items' => array_map([$this, 'serialize'], $result['items']), 'total' => $result['total']];
    }

    public function find(int $id, ?int $shopId = null): ?array
    {
        return $this->catalogues->find($id, $shopId);
    }

    /** @return array<string,mixed> */
    public function serialize(array $row): array
    {
        $settings = $row['settings'];

        return [
            'id'           => (int) $row['id'],
            'title'        => (string) $row['title'],
            'owner'        => (string) $row['owner'],
            'shop'         => $row['shop_id'] !== null ? [
                'id'        => (int) $row['shop_id'],
                'erpShopId' => $row['shop_erp_id'] !== null ? (int) $row['shop_erp_id'] : null,
                'name'      => (string) ($row['shop_name'] ?? ''),
            ] : null,
            'source'       => ['kind' => (string) $row['source_kind'], 'ref' => $row['source_ref'] === null ? null : explode(',', (string) $row['source_ref'])[0], 'refs' => $row['source_ref'] === null ? [] : explode(',', (string) $row['source_ref']), 'label' => $row['source_label']],
            'format'       => (string) $row['format'],
            'status'       => (string) $row['status'],
            'printQty'     => $row['print_qty'] !== null ? (int) $row['print_qty'] : null,
            'langs'        => array_values($settings['langs'] ?? ['fr']),
            'shopIds'      => array_values(array_map('intval', $settings['shopIds'] ?? [])),
            'products'     => array_values($settings['products'] ?? []),
            'pages'        => array_values($settings['pages'] ?? []),
            'productCount' => count(array_filter($settings['products'] ?? [], static fn (array $p): bool => (bool) ($p['on'] ?? false))),
            'pageCount'    => 2 + count($settings['pages'] ?? []),
            'createdAt'    => self::iso((string) $row['created_at']),
            'updatedAt'    => self::iso((string) $row['updated_at']),
        ];
    }

    private static function iso(string $datetime): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', (int) strtotime($datetime));
    }

    // ---------------------------------------------------------------------------------------------
    // Écriture
    // ---------------------------------------------------------------------------------------------

    /**
     * Crée un catalogue. Pour une boutique (`$shop` non nul) : source gamme ou choix, produits de
     * sa boutique seulement, aucune boutique d'une autre version.
     *
     * @param array<string,mixed> $input
     * @param array{id:int, name:string, erpShopId:?int}|null $shop
     */
    public function create(array $input, ?array $shop, ?int $userId): array
    {
        $owner = $shop === null ? 'marque' : 'boutique';
        $allowed = ['title', 'source', 'format', 'langs', 'products', 'pages'];
        if ($owner === 'marque') {
            $allowed[] = 'shopIds';
        }
        $errors = self::unknown($input, $allowed);

        $title = self::title($input['title'] ?? null, $errors);
        $source = is_array($input['source'] ?? null) ? $input['source'] : null;
        $kind = is_string($source['kind'] ?? null) ? $source['kind'] : '';
        $kinds = $owner === 'boutique' ? ['gamme', 'choix'] : self::SOURCES;
        if (!in_array($kind, $kinds, true)) {
            $errors[] = ['field' => 'source.kind', 'message' => 'Attendu : ' . implode(', ', $kinds) . '.'];
        }
        if ($source !== null) {
            $errors = array_merge($errors, self::unknown($source, ['kind', 'ref'], 'source.'));
        }
        $ref = $source['ref'] ?? null;
        $estId = static fn (mixed $v): bool => is_int($v) || (is_string($v) && ctype_digit($v));
        // Une gamme ou plusieurs : `ref` est un identifiant ou une liste d'identifiants (au plus 8).
        $gammeIds = [];
        if ($kind === 'gamme') {
            $liste = is_array($ref) ? $ref : [$ref];
            if ($liste === [] || count($liste) > 8 || array_filter($liste, static fn ($v): bool => !$estId($v)) !== []) {
                $errors[] = ['field' => 'source.ref', 'message' => 'Une gamme, ou une liste de gammes (8 au plus), attendue.'];
            } else {
                $gammeIds = array_values(array_unique(array_map('intval', $liste)));
            }
        } elseif ($kind === 'campagne' && !$estId($ref)) {
            $errors[] = ['field' => 'source.ref', 'message' => 'Identifiant de la campagne attendu.'];
        }
        $format = self::format($input['format'] ?? 'A5', $errors);
        $langs = self::langs($input['langs'] ?? ['fr'], $errors);
        $shopIds = $owner === 'marque' ? $this->shopIds($input['shopIds'] ?? [], $errors) : [];
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Catalogue invalide.', 422, $errors);
        }

        $label = null;
        $products = [];
        $refId = $kind === 'campagne' ? (int) $ref : ($kind === 'gamme' ? $gammeIds[0] : null);
        if ($kind === 'campagne') {
            $campaign = $this->catalogues->campaign((int) $refId);
            if ($campaign === null) {
                throw new CatalogueError('VALIDATION_FAILED', 'Campagne inconnue.', 422, [['field' => 'source.ref', 'message' => 'Campagne inconnue.']]);
            }
            $label = $campaign['name'];
            $products = $campaign['productIds'];
            if ($shopIds === [] && $campaign['shopIds'] !== []) {
                $shopIds = $campaign['shopIds'];
            }
        }

        $row = [
            'title'        => $title,
            'owner'        => $owner,
            'shop_id'      => $shop['id'] ?? null,
            'source_kind'  => $kind,
            'source_ref'   => $kind === 'gamme' ? implode(',', $gammeIds) : ($refId !== null ? (string) $refId : null),
            'source_label' => $label,
            'format'       => $format,
            'status'       => 'brouillon',
            'print_qty'    => null,
            'settings'     => ['langs' => $langs, 'shopIds' => $shopIds, 'products' => [], 'pages' => []],
        ];
        $data = $this->webshopProducts($this->shopsOf($row));
        $known = array_column($data['products'], null, 'id');

        if ($kind === 'gamme') {
            $noms = [];
            foreach ($gammeIds as $gid) {
                $nom = null;
                foreach ($data['gammes'] as $candidate) {
                    if ((int) $candidate['id'] === $gid) {
                        $nom = $candidate['name'];
                    }
                }
                if ($nom === null) {
                    throw new CatalogueError('VALIDATION_FAILED', 'Gamme inconnue du webshop.', 422, [['field' => 'source.ref', 'message' => sprintf('Gamme %d inconnue ou inactive.', $gid)]]);
                }
                $noms[] = $nom;
            }
            $row['source_label'] = mb_substr(implode(' + ', $noms), 0, 160);
            foreach ($data['products'] as $product) {
                if (array_intersect($gammeIds, $product['gammes']) !== []) {
                    $products[] = (int) $product['id'];
                }
            }
        }

        // Des produits envoyés à la création remplacent ceux de la source.
        if (array_key_exists('products', $input)) {
            $row['settings']['products'] = $this->productRows($input['products'], $row, $known);
        } else {
            $row['settings']['products'] = array_map(static fn (int $id): array => ['id' => $id, 'on' => true], array_values(array_unique($products)));
        }
        $row['settings']['pages'] = array_key_exists('pages', $input)
            ? $this->pageRows($input['pages'], $row, $known)
            : [];
        if ($row['settings']['pages'] === []) {
            $row['settings']['pages'] = self::autoPages($row['settings']['products'], $known);
        }

        $id = $this->catalogues->insert($row, $userId);

        return $this->serialize((array) $this->catalogues->find($id));
    }

    /**
     * Remplace les champs modifiables d'un catalogue. `pages: []` : répartition automatique, une
     * catégorie après l'autre, en grilles.
     *
     * @param array<string,mixed> $input
     */
    public function update(array $current, array $input, ?int $scopeShopId, ?int $userId): array
    {
        $boutique = $current['owner'] === 'boutique';
        $allowed = ['title', 'format', 'langs', 'products', 'pages', 'status', 'printQty'];
        if (!$boutique) {
            $allowed[] = 'shopIds';
        }
        $errors = self::unknown($input, $allowed);
        $row = $current;
        $settings = $current['settings'];

        if (array_key_exists('title', $input)) {
            $row['title'] = self::title($input['title'], $errors);
        }
        if (array_key_exists('format', $input)) {
            $row['format'] = self::format($input['format'], $errors);
        }
        if (array_key_exists('langs', $input)) {
            $settings['langs'] = self::langs($input['langs'], $errors);
        }
        if (array_key_exists('shopIds', $input)) {
            $settings['shopIds'] = $this->shopIds($input['shopIds'], $errors);
        }
        if (array_key_exists('status', $input)) {
            if (!is_string($input['status']) || !in_array($input['status'], self::STATUSES, true)) {
                $errors[] = ['field' => 'status', 'message' => 'Attendu : ' . implode(', ', self::STATUSES) . '.'];
            } else {
                $row['status'] = $input['status'];
            }
        }
        if (array_key_exists('printQty', $input)) {
            $qty = $input['printQty'];
            if ($qty !== null && (!is_int($qty) || $qty < 1 || $qty > 1000000)) {
                $errors[] = ['field' => 'printQty', 'message' => 'Nombre d’exemplaires entre 1 et 1 000 000, ou null.'];
            } else {
                $row['print_qty'] = $qty;
            }
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Catalogue invalide.', 422, $errors);
        }

        $row['settings'] = $settings;
        if (array_key_exists('products', $input) || array_key_exists('pages', $input) || array_key_exists('shopIds', $input)) {
            $known = array_column($this->webshopProducts($this->shopsOf($row))['products'], null, 'id');
            if (array_key_exists('products', $input)) {
                $settings['products'] = $this->productRows($input['products'], $row, $known);
            }
            $row['settings'] = $settings;
            if (array_key_exists('pages', $input)) {
                $settings['pages'] = $this->pageRows($input['pages'], $row, $known);
                if ($settings['pages'] === []) {
                    $settings['pages'] = self::autoPages($settings['products'], $known);
                }
            }
            $row['settings'] = $settings;
        }

        $this->catalogues->update((int) $current['id'], $row, $userId, $scopeShopId);

        return $this->serialize((array) $this->catalogues->find((int) $current['id'], $scopeShopId));
    }

    public function delete(int $id, ?int $scopeShopId = null): bool
    {
        return $this->catalogues->delete($id, $scopeShopId);
    }

    /**
     * Les produits du catalogue : identifiants du webshop, cochés ou non, dans l'ordre. Une
     * boutique ne peut mettre que des produits que SA boutique vend (refus nommé sinon).
     *
     * @param array<int, array<string,mixed>> $known Produits lus, par identifiant.
     * @return list<array{id:int, on:bool}>
     */
    private function productRows(mixed $raw, array $row, array $known): array
    {
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > self::PRODUCTS_MAX) {
            throw new CatalogueError('VALIDATION_FAILED', 'Liste de produits invalide.', 422, [['field' => 'products', 'message' => 'Liste de ' . self::PRODUCTS_MAX . ' produits au plus attendue.']]);
        }
        $out = [];
        $errors = [];
        $notSold = [];
        foreach ($raw as $index => $item) {
            if (!is_array($item) || !is_int($item['id'] ?? null) || $item['id'] <= 0 || array_diff(array_keys($item), ['id', 'on']) !== []
                || (array_key_exists('on', $item) && !is_bool($item['on']))) {
                $errors[] = ['field' => 'products[' . $index . ']', 'message' => 'Forme attendue : {id: entier, on: booléen}.'];
                continue;
            }
            if (isset($out[$item['id']])) {
                continue;
            }
            if ($row['owner'] === 'boutique' && !isset($known[$item['id']])) {
                $notSold[] = ['field' => 'products[' . $index . ']', 'message' => 'Produit ' . $item['id'] . ' : pas vendu sur le webshop de la boutique.'];
                continue;
            }
            $out[$item['id']] = ['id' => $item['id'], 'on' => $item['on'] ?? true];
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Liste de produits invalide.', 422, $errors);
        }
        if ($notSold !== []) {
            throw new CatalogueError('CATALOGUE_PRODUCT_NOT_SOLD', 'Ces produits ne sont pas vendus par la boutique.', 422, $notSold);
        }

        return array_values($out);
    }

    /**
     * Les pages intérieures : `{layout, category}` (catégorie du webshop, ou null : « Notre
     * sélection »). Trois mises en page, pas une de plus.
     *
     * @return list<array{layout:string, category:?int}>
     */
    private function pageRows(mixed $raw, array $row, array $known): array
    {
        unset($row, $known);
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > self::PAGES_MAX) {
            throw new CatalogueError('VALIDATION_FAILED', 'Pages invalides.', 422, [['field' => 'pages', 'message' => 'Liste de ' . self::PAGES_MAX . ' pages au plus attendue.']]);
        }
        $out = [];
        $errors = [];
        foreach ($raw as $index => $page) {
            $layout = is_array($page) ? ($page['layout'] ?? null) : null;
            $category = is_array($page) && array_key_exists('category', $page) ? $page['category'] : null;
            if (!is_array($page) || array_diff(array_keys($page), ['layout', 'category']) !== []) {
                $errors[] = ['field' => 'pages[' . $index . ']', 'message' => 'Forme attendue : {layout, category}.'];
            } elseif (!is_string($layout) || !isset(self::LAYOUTS[$layout])) {
                $errors[] = ['field' => 'pages[' . $index . '].layout', 'message' => 'Mise en page : ' . implode(', ', array_keys(self::LAYOUTS)) . '.'];
            } elseif ($category !== null && (!is_int($category) || $category <= 0)) {
                $errors[] = ['field' => 'pages[' . $index . '].category', 'message' => 'Identifiant de catégorie du webshop, ou null.'];
            } else {
                $out[] = ['layout' => $layout, 'category' => $category];
            }
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Pages invalides.', 422, $errors);
        }

        return $out;
    }

    /**
     * La répartition automatique : une catégorie après l'autre (dans l'ordre des produits), en
     * grilles de six ; la première page de la première catégorie en vedette.
     *
     * @param list<array{id:int, on:bool}> $products
     * @return list<array{layout:string, category:?int}>
     */
    public static function autoPages(array $products, array $known): array
    {
        $byCategory = [];
        foreach ($products as $product) {
            if (!$product['on'] || !isset($known[$product['id']])) {
                continue;
            }
            $category = $known[$product['id']]['categoryId'] ?? 0;
            $byCategory[(int) $category] = ($byCategory[(int) $category] ?? 0) + 1;
        }
        $pages = [];
        foreach ($byCategory as $category => $count) {
            $first = $pages === [];
            $left = $count;
            while ($left > 0) {
                $layout = $first ? 'vedette' : 'grille';
                $pages[] = ['layout' => $layout, 'category' => $category > 0 ? $category : null];
                $left -= self::LAYOUTS[$layout];
                $first = false;
            }
        }

        return $pages;
    }

    // ---------------------------------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------------------------------

    /** @return list<array{field:string, message:string}> */
    private static function unknown(array $input, array $allowed, string $prefix = ''): array
    {
        $errors = [];
        foreach (array_keys($input) as $key) {
            if (!in_array($key, $allowed, true)) {
                $errors[] = ['field' => $prefix . $key, 'message' => 'Champ inconnu.'];
            }
        }

        return $errors;
    }

    private static function title(mixed $value, array &$errors): string
    {
        $title = is_string($value) ? trim($value) : '';
        if ($title === '' || mb_strlen($title) > self::TITLE_MAX) {
            $errors[] = ['field' => 'title', 'message' => 'Titre de 1 à ' . self::TITLE_MAX . ' caractères.'];
        }

        return $title;
    }

    private static function format(mixed $value, array &$errors): string
    {
        if (!is_string($value) || !in_array($value, self::FORMATS, true)) {
            $errors[] = ['field' => 'format', 'message' => 'Format : A5 ou A4.'];

            return 'A5';
        }

        return $value;
    }

    /** @return list<string> */
    private static function langs(mixed $value, array &$errors): array
    {
        if (!is_array($value) || $value === [] || array_diff($value, self::LANGS) !== []) {
            $errors[] = ['field' => 'langs', 'message' => 'Langues : fr, nl (au moins une).'];

            return ['fr'];
        }

        return array_values(array_intersect(self::LANGS, $value));
    }

    /** @return list<int> */
    private function shopIds(mixed $value, array &$errors): array
    {
        if (!is_array($value) || !array_is_list($value) || count($value) > self::SHOPS_MAX) {
            $errors[] = ['field' => 'shopIds', 'message' => 'Liste d’identifiants de boutiques attendue.'];

            return [];
        }
        $ids = [];
        foreach ($value as $id) {
            if (!is_int($id) || $id <= 0) {
                $errors[] = ['field' => 'shopIds', 'message' => 'Identifiants entiers attendus.'];

                return [];
            }
            $ids[$id] = $id;
        }
        $ids = array_values($ids);
        if ($ids !== []) {
            $missing = array_values(array_diff($ids, array_column($this->catalogues->shops($ids), 'id')));
            if ($missing !== []) {
                $errors[] = ['field' => 'shopIds', 'message' => 'Boutiques inconnues : ' . implode(', ', $missing) . '.'];
            }
        }

        return $ids;
    }

    // ---------------------------------------------------------------------------------------------
    // Charte des catalogues
    // ---------------------------------------------------------------------------------------------

    /** La charte enregistrée, complétée des valeurs par défaut. @return array<string,mixed> */
    public function charter(): array
    {
        $saved = Config::value(self::CHARTER_VARIABLE);
        $saved = is_array($saved) ? $saved : [];
        $default = self::defaultCharter();

        $covers = [];
        foreach ((array) ($saved['covers'] ?? []) as $cover) {
            if (is_array($cover)) {
                $covers[] = array_replace($default['covers'][0], array_intersect_key($cover, $default['covers'][0]));
            }
        }
        if (!in_array(null, array_column($covers, 'gamme'), true)) {
            array_unshift($covers, $default['covers'][0]);
        }

        $out = [
            'logoMediaId' => is_int($saved['logoMediaId'] ?? null) ? $saved['logoMediaId'] : null,
            'colors'      => array_replace($default['colors'], array_intersect_key((array) ($saved['colors'] ?? []), $default['colors'])),
            'covers'      => $covers,
            'back'        => array_replace($default['back'], array_intersect_key((array) ($saved['back'] ?? []), $default['back'])),
            'updatedAt'   => isset(Config::all()[self::CHARTER_VARIABLE]) ? self::iso(Config::all()[self::CHARTER_VARIABLE]['updated_at']) : null,
        ];
        $out['logoUrl'] = $this->mediaUrl($out['logoMediaId']);
        foreach ($out['covers'] as &$cover) {
            $cover['imageUrl'] = $this->mediaUrl($cover['mediaId']);
        }
        unset($cover);

        return $out;
    }

    /** @return array<string,mixed> */
    private static function defaultCharter(): array
    {
        return [
            'logoMediaId' => null,
            'colors'      => ['primary' => '#8D1D2C', 'secondary' => '#F5EFE4', 'accent' => '#B0792A', 'ink' => '#241C1A'],
            'covers'      => [['gamme' => null, 'titleFr' => 'Notre catalogue', 'titleNl' => 'Onze catalogus', 'subtitleFr' => '', 'subtitleNl' => '', 'mediaId' => null]],
            'back'        => [
                'titleFr' => 'Commandez en ligne',
                'titleNl' => 'Bestel online',
                'textFr'  => 'Retrait en boutique ou livraison.',
                'textNl'  => 'Afhalen in de winkel of levering.',
            ],
        ];
    }

    /**
     * Remplace la charte. Réservé à la marque (le contrôleur le vérifie).
     *
     * @param array<string,mixed> $input
     */
    public function saveCharter(array $input, ?int $userId): array
    {
        $errors = self::unknown($input, ['logoMediaId', 'colors', 'covers', 'back']);
        $default = self::defaultCharter();

        $logo = $input['logoMediaId'] ?? null;
        if ($logo !== null && (!is_int($logo) || $this->media->find($logo) === null)) {
            $errors[] = ['field' => 'logoMediaId', 'message' => 'Fichier inconnu de la médiathèque.'];
        }

        $colors = $input['colors'] ?? $default['colors'];
        if (!is_array($colors)) {
            $errors[] = ['field' => 'colors', 'message' => 'Objet {primary, secondary, accent, ink} attendu.'];
            $colors = $default['colors'];
        }
        $errors = array_merge($errors, self::unknown($colors, array_keys($default['colors']), 'colors.'));
        foreach ($colors as $key => $value) {
            if (!is_string($value) || preg_match('/^#[0-9A-Fa-f]{6}$/', $value) !== 1) {
                $errors[] = ['field' => 'colors.' . $key, 'message' => 'Couleur #RRGGBB attendue.'];
            }
        }

        $covers = [];
        $raw = $input['covers'] ?? [];
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > 60) {
            $errors[] = ['field' => 'covers', 'message' => 'Liste de couvertures attendue.'];
            $raw = [];
        }
        $seen = [];
        foreach ($raw as $index => $cover) {
            $field = 'covers[' . $index . ']';
            if (!is_array($cover)) {
                $errors[] = ['field' => $field, 'message' => 'Objet attendu.'];
                continue;
            }
            $errors = array_merge($errors, self::unknown($cover, array_keys($default['covers'][0]), $field . '.'));
            $gamme = $cover['gamme'] ?? null;
            if ($gamme !== null && (!is_int($gamme) || $gamme <= 0)) {
                $errors[] = ['field' => $field . '.gamme', 'message' => 'Identifiant de gamme du webshop, ou null (couverture générique).'];
            }
            $key = $gamme === null ? 'generique' : (string) $gamme;
            if (isset($seen[$key])) {
                $errors[] = ['field' => $field . '.gamme', 'message' => 'Une seule couverture par gamme.'];
            }
            $seen[$key] = true;
            $media = $cover['mediaId'] ?? null;
            if ($media !== null && (!is_int($media) || $this->media->find($media) === null)) {
                $errors[] = ['field' => $field . '.mediaId', 'message' => 'Fichier inconnu de la médiathèque.'];
            }
            $clean = ['gamme' => $gamme, 'mediaId' => $media];
            foreach (['titleFr', 'titleNl', 'subtitleFr', 'subtitleNl'] as $text) {
                $clean[$text] = self::text($cover[$text] ?? '', $field . '.' . $text, $errors);
            }
            if ($clean['titleFr'] === '') {
                $errors[] = ['field' => $field . '.titleFr', 'message' => 'Le titre français est obligatoire.'];
            }
            $covers[] = $clean;
        }

        $back = $input['back'] ?? $default['back'];
        if (!is_array($back)) {
            $errors[] = ['field' => 'back', 'message' => 'Objet attendu.'];
            $back = $default['back'];
        }
        $errors = array_merge($errors, self::unknown($back, array_keys($default['back']), 'back.'));
        $cleanBack = [];
        foreach (array_keys($default['back']) as $text) {
            $cleanBack[$text] = self::text($back[$text] ?? '', 'back.' . $text, $errors);
        }

        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Charte des catalogues invalide.', 422, $errors);
        }

        Config::put(self::CHARTER_VARIABLE, [
            'logoMediaId' => $logo,
            'colors'      => array_replace($default['colors'], $colors),
            'covers'      => $covers,
            'back'        => $cleanBack,
        ], 'marketing', $userId, 'Charte des catalogues : logo, couvertures par gamme, dernière page, couleurs.');

        return $this->charter();
    }

    private static function text(mixed $value, string $field, array &$errors): string
    {
        if (!is_string($value) || mb_strlen($value) > self::TEXT_MAX) {
            $errors[] = ['field' => $field, 'message' => 'Texte de ' . self::TEXT_MAX . ' caractères au plus.'];

            return '';
        }

        return trim($value);
    }

    private function mediaUrl(?int $id): ?string
    {
        if ($id === null) {
            return null;
        }
        $row = $this->media->find($id);

        return $row === null ? null : (string) $this->media->serialize($row)['url'];
    }

    // ---------------------------------------------------------------------------------------------
    // Composition : le document imprimé d'une version
    // ---------------------------------------------------------------------------------------------

    /**
     * Le catalogue mis en pages pour une version : générale (`$versionShopId` nul) ou d'une
     * boutique (prix de SA boutique, ses produits, son QR et ses coordonnées). Une boutique n'a
     * qu'une version : la sienne.
     *
     * @return array<string,mixed>
     */
    public function document(array $row, ?int $versionShopId, string $lang): array
    {
        if (!in_array($lang, self::LANGS, true)) {
            throw new CatalogueError('VALIDATION_FAILED', 'Langue : fr ou nl.', 422, [['field' => 'lang', 'message' => 'fr ou nl.']]);
        }
        if ($row['owner'] === 'boutique') {
            $versionShopId = (int) $row['shop_id'];
        }
        $shops = $this->shopsOf($row);
        $version = null;
        if ($versionShopId !== null) {
            foreach ($shops as $shop) {
                if ($shop['id'] === $versionShopId) {
                    $version = $shop;
                }
            }
            if ($version === null) {
                throw new CatalogueError('VALIDATION_FAILED', 'Cette boutique n’a pas de version dans ce catalogue.', 422, [['field' => 'shopId', 'message' => 'Boutique hors du catalogue.']]);
            }
        }

        $data = $this->webshopProducts($version !== null ? [$version] : $shops);
        $known = array_column($data['products'], null, 'id');
        $categories = array_column($data['categories'], null, 'id');
        $warnings = [];
        foreach ($data['shops'] as $read) {
            if ($read['error'] !== null) {
                $warnings[] = ['code' => 'WEBSHOP_UNREADABLE', 'message' => sprintf('Webshop de %s illisible : %s', $read['name'], $read['error'])];
            }
        }

        $chosen = [];
        $absent = [];
        foreach ($row['settings']['products'] ?? [] as $item) {
            if (!($item['on'] ?? false)) {
                continue;
            }
            $product = $known[$item['id']] ?? null;
            if ($product === null) {
                $absent[] = $item['id'];
                continue;
            }
            $price = $product['priceCents'];
            if ($version !== null) {
                $mine = $product['prices'][0] ?? null;
                $price = $mine['webPriceCents'] ?? $mine['shopPriceCents'] ?? null;
                if ($mine !== null && $mine['webPriceCents'] !== null && $mine['shopPriceCents'] !== null && $mine['webPriceCents'] !== $mine['shopPriceCents']) {
                    $warnings[] = ['code' => 'PRICE_DIFFERS', 'message' => sprintf('%s : %s au webshop, %s au comptoir de la boutique — le catalogue prend le prix du webshop.',
                        $product['name'], self::money($mine['webPriceCents']), self::money($mine['shopPriceCents']))];
                }
            } elseif ($product['priceDiffers'] !== []) {
                $warnings[] = ['code' => 'PRICE_DIFFERS', 'message' => sprintf('%s : prix différent dans %d boutique(s) — chaque version de boutique prend le sien.', $product['name'], count($product['priceDiffers']))];
            }
            if ($price === null) {
                $warnings[] = ['code' => 'PRODUCT_NO_PRICE', 'message' => $product['name'] . ' : pas de prix au webshop.'];
            }
            $chosen[] = [
                'id'         => $product['id'],
                'name'       => $lang === 'nl' ? $product['nameNl'] : $product['name'],
                'imageUrl'   => $product['imageUrl'],
                'categoryId' => $product['categoryId'],
                'priceCents' => $price,
                'currency'   => 'EUR',
            ];
        }
        if ($absent !== []) {
            $warnings[] = ['code' => 'PRODUCT_NOT_SOLD', 'message' => sprintf('%d produit(s) coché(s) absent(s) du webshop%s : retiré(s) de cette version.',
                count($absent), $version !== null ? ' de ' . $version['name'] : '')];
        }

        // Les pages intérieures : chaque page prend les produits de sa catégorie, dans l'ordre.
        $queues = [];
        foreach ($chosen as $product) {
            $queues[(int) ($product['categoryId'] ?? 0)][] = $product;
        }
        $inner = [];
        foreach ($row['settings']['pages'] ?? [] as $page) {
            $capacity = self::LAYOUTS[$page['layout']] ?? 6;
            $items = [];
            if ($page['category'] !== null) {
                $queues[$page['category']] ??= [];
                $items = array_splice($queues[$page['category']], 0, $capacity);
            } else {
                foreach ($queues as $key => $queue) {
                    if (count($items) >= $capacity) {
                        break;
                    }
                    $items = array_merge($items, array_splice($queues[$key], 0, $capacity - count($items)));
                }
            }
            $category = $page['category'] !== null ? ($categories[$page['category']] ?? null) : null;
            $inner[] = [
                'kind'     => 'products',
                'locked'   => false,
                'layout'   => $page['layout'],
                'category' => $page['category'],
                'title'    => $category !== null ? ($lang === 'nl' ? $category['nameNl'] : $category['name']) : ($lang === 'nl' ? 'Onze selectie' : 'Notre sélection'),
                'products' => array_map(static fn (array $p): array => array_diff_key($p, ['categoryId' => true]), $items),
            ];
        }
        $left = array_sum(array_map('count', $queues));
        if ($left > 0) {
            $warnings[] = ['code' => 'PRODUCTS_OVERFLOW', 'message' => sprintf('%d produit(s) sans place : ajoutez une page ou choisissez une mise en page plus dense.', $left)];
        }

        // Couverture et dernière page : la charte, verrouillées.
        $charter = $this->charter();
        // Plusieurs gammes : la couverture de la première qui en a une dans la charte, sinon la générique.
        $gammeIds = $row['source_kind'] === 'gamme' ? array_map('intval', explode(',', (string) $row['source_ref'])) : [];
        $gammeId = $gammeIds[0] ?? null;
        foreach ($gammeIds as $gid) {
            if (in_array($gid, array_column($charter['covers'] ?? [], 'gamme'), true)) {
                $gammeId = $gid;
                break;
            }
        }
        $generic = $charter['covers'][0];
        $cover = $generic;
        foreach ($charter['covers'] as $candidate) {
            if ($candidate['gamme'] === null) {
                $generic = $candidate;
            }
        }
        $cover = $generic;
        $gammeImage = null;
        if ($gammeId !== null) {
            foreach ($charter['covers'] as $candidate) {
                if ($candidate['gamme'] === $gammeId) {
                    $cover = $candidate;
                }
            }
            foreach ($data['gammes'] as $gamme) {
                if ((int) $gamme['id'] === $gammeId) {
                    $gammeImage = $gamme['image'];
                }
            }
        }
        $coverTitle = $lang === 'nl' ? ($cover['titleNl'] ?: $cover['titleFr']) : $cover['titleFr'];
        if ($cover === $generic && $gammeId !== null && $row['source_label']) {
            $coverTitle = (string) $row['source_label'];
            if ($lang === 'nl') {
                $warnings[] = ['code' => 'NL_TEXT_MISSING', 'message' => sprintf('Pas de couverture « %s » dans la Charte des catalogues : le nom français de la gamme est imprimé.', $coverTitle)];
            }
        }
        if ($lang === 'nl' && $cover['titleNl'] === '' && !($cover === $generic && $gammeId !== null)) {
            $warnings[] = ['code' => 'NL_TEXT_MISSING', 'message' => 'Titre néerlandais de la couverture à écrire dans la Charte des catalogues : le français est imprimé.'];
        }
        $backTitle = $lang === 'nl' ? ($charter['back']['titleNl'] ?: $charter['back']['titleFr']) : $charter['back']['titleFr'];
        $backText = $lang === 'nl' ? ($charter['back']['textNl'] ?: $charter['back']['textFr']) : $charter['back']['textFr'];
        if ($lang === 'nl' && ($charter['back']['titleNl'] === '' || $charter['back']['textNl'] === '')) {
            $warnings[] = ['code' => 'NL_TEXT_MISSING', 'message' => 'Dernière page néerlandaise à écrire dans la Charte des catalogues : le français est imprimé.'];
        }

        $webshop = self::webshopUrl();
        $shopInfo = null;
        if ($version !== null) {
            $shopInfo = ['id' => $version['id'], 'erpShopId' => $version['erpShopId'], 'name' => $version['name'], 'address' => '', 'hours' => '', 'phone' => ''];
            if ($version['erpShopId'] !== null) {
                $info = $this->webshop->shop($version['erpShopId']);
                if ($info['shop'] !== null) {
                    $shopInfo['name'] = $info['shop']['name'] !== '' ? $info['shop']['name'] : $version['name'];
                    $shopInfo['address'] = $info['shop']['address'];
                    $shopInfo['hours'] = $lang === 'nl' ? $info['shop']['hoursNl'] : $info['shop']['hours'];
                    $shopInfo['phone'] = $info['shop']['phone'];
                }
                if ($info['shop'] === null || $info['shop']['address'] === '') {
                    $warnings[] = ['code' => 'SHOP_ADDRESS_MISSING', 'message' => sprintf('Adresse de %s inconnue de TFBuddy%s.', $version['name'], $info['error'] !== null ? ' (' . $info['error'] . ')' : '')];
                }
            }
        }
        if ($webshop === null) {
            $warnings[] = ['code' => 'WEBSHOP_URL_UNKNOWN', 'message' => 'Adresse du webshop inconnue (réglage webshop_url du module Social) : pas de QR code.'];
        }
        $qrUrl = $webshop === null ? null : ($version !== null && $version['erpShopId'] !== null ? $webshop . '?shop=' . $version['erpShopId'] : $webshop);

        $pages = array_merge(
            [[
                'kind'     => 'cover',
                'locked'   => true,
                'title'    => $coverTitle,
                'subtitle' => $lang === 'nl' ? ($cover['subtitleNl'] ?: $cover['subtitleFr']) : $cover['subtitleFr'],
                'eyebrow'  => $version !== null ? $shopInfo['name'] : null,
                'imageUrl' => $cover['imageUrl'] ?? $gammeImage,
            ]],
            $inner,
            [[
                'kind'   => 'back',
                'locked' => true,
                'title'  => $backTitle,
                'text'   => $backText,
                'qrUrl'  => $qrUrl,
                'host'   => $webshop === null ? null : (string) preg_replace('#^https?://|/+$#', '', $webshop),
                'shop'   => $shopInfo,
            ]],
        );

        return [
            'catalogue' => ['id' => (int) $row['id'], 'title' => (string) $row['title'], 'format' => (string) $row['format'], 'owner' => (string) $row['owner']],
            'version'   => ['shop' => $shopInfo, 'lang' => $lang],
            'charter'   => ['logoUrl' => $charter['logoUrl'], 'colors' => $charter['colors']],
            'pages'     => $pages,
            'warnings'  => array_values(array_unique($warnings, SORT_REGULAR)),
        ];
    }

    private static function money(?int $cents): string
    {
        return $cents === null ? '—' : number_format($cents / 100, 2, ',', ' ') . ' €';
    }

    /** L'adresse du webshop du réseau : réglage du module Social (`webshop_url`), sinon du Marketing. */
    public static function webshopUrl(): ?string
    {
        $social = Config::value('webshop_url', 'social');
        $url = is_string($social) && trim($social) !== '' ? trim($social) : (string) (Config::get('MAR_WEBSHOP_URL') ?? '');
        if (preg_match('#^https?://#', $url) !== 1) {
            return null;
        }

        return rtrim($url, '/') . '/';
    }

    // ---------------------------------------------------------------------------------------------
    // Liens d'impression (le PDF d'un catalogue de boutique, ouvert depuis le dashboard)
    // ---------------------------------------------------------------------------------------------

    /**
     * Un lien signé vers la page d'impression du catalogue, valable 48 h. `null` : le secret des
     * sessions manque, rien ne se signe.
     *
     * @return array{token:string, expiresAt:string}|null
     */
    public function printToken(int $catalogueId, string $lang, ?int $now = null): ?array
    {
        $secret = (string) (Keys::get('MAR_SESSION_SECRET') ?? '');
        if (strlen($secret) < 32 || !in_array($lang, self::LANGS, true)) {
            return null;
        }
        $expires = ($now ?? time()) + self::PRINT_TTL;
        $payload = $catalogueId . '.' . $lang . '.' . $expires;
        $signature = hash_hmac('sha256', 'catalogue:' . $payload, $secret, true);
        // Sans point : un « . » dans le chemin ferait prendre le lien pour un fichier par certains serveurs.
        // La signature (32 octets) fait toujours 43 caractères : elle se détache par la fin.
        $token = self::b64($payload) . self::b64($signature);

        return ['token' => $token, 'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', $expires)];
    }

    /** @return array{id:int, lang:string}|null Le catalogue et la langue d'un lien valable. */
    public function readPrintToken(string $token, ?int $now = null): ?array
    {
        $secret = (string) (Keys::get('MAR_SESSION_SECRET') ?? '');
        if (strlen($secret) < 32 || strlen($token) <= 43) {
            return null;
        }
        $payload = self::unb64(substr($token, 0, -43));
        $signature = self::unb64(substr($token, -43));
        if ($payload === null || $signature === null || !hash_equals(hash_hmac('sha256', 'catalogue:' . $payload, $secret, true), $signature)) {
            return null;
        }
        if (preg_match('/^(\d+)\.(fr|nl)\.(\d+)$/', $payload, $m) !== 1 || (int) $m[3] < ($now ?? time())) {
            return null;
        }

        return ['id' => (int) $m[1], 'lang' => $m[2]];
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function unb64(string $value): ?string
    {
        if (preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
            return null;
        }
        $raw = base64_decode(strtr($value, '-_', '+/'), true);

        return $raw === false ? null : $raw;
    }

    // ---------------------------------------------------------------------------------------------
    // Boutiques (identité de service)
    // ---------------------------------------------------------------------------------------------

    /** La boutique du module derrière un identifiant de caisse. */
    public function shopByErpId(int $erpShopId): ?array
    {
        return $this->catalogues->shopByErpId($erpShopId);
    }

    /** @return list<array{id:int, name:string, erpShopId:?int}> */
    public function shops(array $ids): array
    {
        return $this->catalogues->shops($ids);
    }
}
