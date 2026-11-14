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
 * Un catalogue a de 8 à 16 pages, toujours un nombre pair (`pageCount` : 8, 10, 12, 14 ou 16, choisi à la
 * création, modifiable par 2). Quatre viennent
 * de la Charte des catalogues de la marque et sont verrouillées : la couverture (page 1), la page 2,
 * l'avant-dernière et la dernière (« commandez en ligne », QR et boutique). Les autres — 4, 8 ou 12
 * pages intérieures, en nombre FIXÉ par le format — sont remplies par catégorie du webshop, chacune
 * dans l'une des trois mises en page (`vedette` 1 + 4, `grille` 2 × 3, `liste` avec prix) — ou sont la
 * page de présentation d'une gamme (`presentation`, `presentation_liste`), chacune en gabarit A, B ou C,
 * la place libre d'une page pas pleine prise par une photo de la médiathèque ou une illustration. Les produits,
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

    /**
     * Mise en page → nombre de produits qu'une page porte. `presentation` : la page d'une gamme (son
     * illustration, son nom, un texte), sans produit ; `presentation_liste` : la même, avec une courte
     * liste des produits de la gamme et leurs prix (8 au plus).
     */
    public const LAYOUTS = ['vedette' => 5, 'grille' => 6, 'liste' => 12, 'presentation' => 0, 'presentation_liste' => 8];

    /** Les mises en page d'une page de présentation (rattachées à une gamme). */
    public const PRESENTATIONS = ['presentation', 'presentation_liste'];

    /** Variantes de gabarit d'une page intérieure ; une page sans gabarit = A. */
    public const TEMPLATES = ['A', 'B', 'C'];

    /** Ce qui occupe la place libre d'une page de produits pas pleine : une photo de la médiathèque, ou l'illustration. */
    public const FILLERS = ['photo', 'illustration'];

    /** Le texte d'une page de présentation, par langue. */
    public const PRESENTATION_TEXT_MAX = 400;

    /** Les champs d'une page intérieure. */
    private const PAGE_KEYS = ['layout', 'category', 'template', 'gamme', 'text', 'textNl', 'filler', 'fillerMediaId'];

    /** Nombre de pages d'un catalogue (couverture et dernière page comprises). */
    /** Tout nombre PAIR de 8 à 16 (client, 14/11/2026 : « rajouter une page, c'est toujours par 2 »). */
    public const PAGE_COUNTS = [8, 10, 12, 14, 16];

    /** Pages de la charte : couverture, page 2, avant-dernière, dernière. */
    public const BRAND_PAGES = 4;

    /**
     * Les promotions de TFBuddy qu'un catalogue montre (client, 14/11/2026 : « rajouter les bundles et promotions
     * (via API) et les appliquer dans une vignette dans la catégorie ») : un bundle, un « X achetés = Y », une
     * promotion de quantité occupent une case de la page de leur catégorie ; une remise programmée barre le prix
     * des produits qu'elle vise. `settings.offers` : les choix explicites `{type, id, on}` ; une offre absente de la
     * liste est cochée d'office quand elle touche un produit coché.
     */
    public const OFFER_TYPES = ['bundle', 'buyXGetY', 'quantity', 'scheduledDiscount'];

    private const OFFERS_MAX = 200;

    /** Produits d'une offre montrés dans sa vignette. */
    private const OFFER_PRODUCTS_SHOWN = 4;

    /** Une page intérieure vide : « Notre sélection », qui prend les produits restés sans place. */
    public const EMPTY_PAGE = ['layout' => 'grille', 'category' => null];

    private const TITLE_MAX    = 160;
    private const PRODUCTS_MAX = 400;
    private const TEXT_MAX     = 240;
    private const PAGE_TEXT_MAX = 1200;
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
                        'availability' => ['periods' => $product['periods'] ?? [], 'leadHours' => $product['leadHours'] ?? null],
                    ];
                }
                $byId[$id]['gammes'] = array_values(array_unique(array_merge($byId[$id]['gammes'], $product['gammes'])));
                // La disponibilité d'un produit lu dans plusieurs boutiques : ce que chacune dit de plus (dates, délai).
                $byId[$id]['availability']['leadHours'] ??= $product['leadHours'] ?? null;
                $dates = array_column($byId[$id]['availability']['periods'], null, 'id');
                foreach ($product['periods'] ?? [] as $period) {
                    $have = $dates[$period['id']] ?? null;
                    if ($have === null || ($have['from'] === null && $have['to'] === null)) {
                        $dates[$period['id']] = $period;
                    }
                }
                $byId[$id]['availability']['periods'] = array_values($dates);
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
                    'availability' => ['periods' => [], 'leadHours' => null],
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

        $gammes = $this->webshop->gammes()['gammes'];
        foreach ($products as &$product) {
            $product['availability'] = self::availabilityOf($product, array_column($gammes, null, 'id'));
        }
        unset($product);

        // Les promotions qui valent pour le réseau ou pour l'une de ces boutiques, encore valables aujourd'hui.
        $erpIds = array_values(array_filter(array_map(static fn (array $s): ?int => $s['erpShopId'], $shops)));
        $offers = $this->offersFor(array_column($products, null, 'id'), $erpIds, false, [date('Y-m-d'), null]);

        return [
            'products'    => $products,
            'categories'  => $categoryOrder,
            'gammes'      => $gammes,
            'shops'       => $read,
            'offers'      => array_map(fn (array $o): array => $this->offerOut($o, array_column($products, null, 'id'), null, 'fr'), $offers['offers']),
            'offersError' => $offers['error'],
        ];
    }

    // ---------------------------------------------------------------------------------------------
    // Promotions et disponibilité
    // ---------------------------------------------------------------------------------------------

    /**
     * La disponibilité d'un produit telle que TFBuddy la donne : ses périodes (gammes) avec leurs dates (celles de
     * la ligne, sinon celles de la gamme) et son délai de préparation. Rien d'inventé : ce qui manque reste vide.
     *
     * @param array<int, array<string,mixed>> $gammesById
     * @return array{periods: list<array{id:int, from:?string, to:?string}>, leadHours: ?int}
     */
    private static function availabilityOf(array $product, array $gammesById): array
    {
        $raw = $product['availability'] ?? [];
        $periods = [];
        $seen = [];
        foreach ($raw['periods'] ?? [] as $period) {
            $gid = (int) $period['id'];
            $seen[$gid] = true;
            $periods[] = ['id' => $gid, 'from' => $period['from'] ?? ($gammesById[$gid]['from'] ?? null), 'to' => $period['to'] ?? ($gammesById[$gid]['to'] ?? null)];
        }
        foreach ($product['gammes'] ?? [] as $gid) {
            if (!isset($seen[(int) $gid]) && isset($gammesById[(int) $gid])) {
                $periods[] = ['id' => (int) $gid, 'from' => $gammesById[(int) $gid]['from'] ?? null, 'to' => $gammesById[(int) $gid]['to'] ?? null];
            }
        }

        return ['periods' => $periods, 'leadHours' => isset($raw['leadHours']) && is_int($raw['leadHours']) && $raw['leadHours'] > 0 ? $raw['leadHours'] : null];
    }

    /**
     * La disponibilité imprimée sous le prix : « du 1/12 au 6/12 », « sur commande 48 h » (NL : « van 1/12 tot
     * 6/12 », « op bestelling 48 u »). La période d'une gamme du catalogue d'abord, sinon la seule du produit.
     * Rien de connu : null.
     *
     * @param list<int> $catalogueGammes
     */
    public static function availabilityText(array $availability, array $catalogueGammes, string $lang): ?string
    {
        $periods = array_values(array_filter($availability['periods'] ?? [], static fn (array $p): bool => ($p['from'] ?? null) !== null || ($p['to'] ?? null) !== null));
        $period = null;
        foreach ($periods as $p) {
            if (in_array((int) $p['id'], $catalogueGammes, true)) {
                $period = $p;
                break;
            }
        }
        if ($period === null && count($periods) === 1) {
            $period = $periods[0];
        }
        $parts = [];
        if ($period !== null) {
            $parts[] = self::rangeText(self::shortDayMonth($period['from'] ?? null), self::shortDayMonth($period['to'] ?? null), $lang);
        }
        $lead = $availability['leadHours'] ?? null;
        if (is_int($lead) && $lead > 0) {
            $parts[] = $lang === 'nl' ? 'op bestelling ' . $lead . ' u' : 'sur commande ' . $lead . ' h';
        }
        $parts = array_values(array_filter($parts, static fn (?string $x): bool => $x !== null && $x !== ''));

        return $parts === [] ? null : implode(' · ', $parts);
    }

    /** « 01/12 » → « 1/12 » ; « 2026-12-01 » → « 1/12 ». */
    private static function shortDayMonth(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1) {
            return (int) $m[3] . '/' . (int) $m[2];
        }
        if (preg_match('/^(\d{1,2})\/(\d{1,2})$/', $value, $m) === 1) {
            return (int) $m[1] . '/' . (int) $m[2];
        }

        return null;
    }

    private static function rangeText(?string $from, ?string $to, string $lang): ?string
    {
        $nl = $lang === 'nl';
        if ($from !== null && $to !== null) {
            return $nl ? "van $from tot $to" : "du $from au $to";
        }
        if ($to !== null) {
            return $nl ? "tot $to" : "jusqu’au $to";
        }
        if ($from !== null) {
            return $nl ? "vanaf $from" : "dès le $from";
        }

        return null;
    }

    /**
     * Les promotions qui s'appliquent : actives, déclenchées d'office (pas « avec un bon seulement »), du réseau ou —
     * hors version générale — de l'une des boutiques, valables pendant `$window` (`[début, fin|null]`, dates
     * AAAA-MM-JJ), et qui touchent au moins un produit ou une catégorie du webshop lu. Pour une seule boutique, les
     * remises programmées sont celles que TFBuddy dit actives pour elle (quand il le dit).
     *
     * @param array<int, array<string,mixed>> $known Produits lus, par identifiant.
     * @param list<int> $erpShopIds
     * @param array{0:string, 1:?string} $window
     * @return array{offers: list<array<string,mixed>>, error: ?string}
     */
    private function offersFor(array $known, array $erpShopIds, bool $networkOnly, array $window): array
    {
        $read = $this->webshop->promotions();
        $errors = [];
        if ($read['error'] !== null) {
            $errors[] = $read['error'];
        }
        foreach ($read['errors'] as $family => $message) {
            $errors[] = $family . ' : ' . $message;
        }
        $active = null;
        if (!$networkOnly && count($erpShopIds) === 1) {
            $active = $this->webshop->activeScheduledDiscounts($erpShopIds[0])['ids'];
        }
        $categories = [];
        foreach ($known as $product) {
            if ($product['categoryId'] !== null) {
                $categories[(int) $product['categoryId']] = true;
            }
        }
        [$start, $end] = $window;
        $out = [];
        foreach ($read['offers'] as $offer) {
            $type = (string) ($offer['family'] ?? '');
            if (!in_array($type, self::OFFER_TYPES, true) || ($offer['status'] ?? '') !== 'ACTIVE' || ($offer['activationMode'] ?? null) === 'VOUCHER_ONLY') {
                continue;
            }
            $shops = array_map(static fn (array $s): int => (int) $s['erpShopId'], $offer['shops'] ?? []);
            if (($offer['shopScope'] ?? 'all') !== 'all' && ($networkOnly || array_intersect($shops, $erpShopIds) === [])) {
                continue;
            }
            if (($offer['validTo'] ?? null) !== null && $offer['validTo'] < $start) {
                continue;
            }
            if ($end !== null && ($offer['validFrom'] ?? null) !== null && $offer['validFrom'] > $end) {
                continue;
            }
            if ($type === 'scheduledDiscount' && $active !== null && !in_array((int) $offer['erpId'], $active, true)) {
                continue;
            }
            $productIds = [];
            foreach ($offer['products'] ?? [] as $p) {
                if (isset($known[(int) $p['erpProductId']])) {
                    $productIds[] = (int) $p['erpProductId'];
                }
            }
            $productIds = array_values(array_unique($productIds));
            // Un bundle dont un produit n'est pas vendu ici ne s'achète pas ici.
            if ($type === 'bundle' && count($productIds) < count(array_unique(array_map(static fn (array $p): int => (int) $p['erpProductId'], $offer['products'] ?? [])))) {
                continue;
            }
            $categoryIds = array_values(array_filter(array_map(static fn (array $c): int => (int) $c['erpCategoryId'], $offer['categories'] ?? []), static fn (int $c): bool => isset($categories[$c])));
            if ($productIds === [] && $categoryIds === []) {
                continue;
            }
            $offer['knownProductIds'] = $productIds;
            $offer['knownCategoryIds'] = $categoryIds;
            $offer['categoryId'] = $productIds !== [] ? $known[$productIds[0]]['categoryId'] : $categoryIds[0];
            $out[] = $offer;
        }

        return ['offers' => $out, 'error' => $errors === [] ? null : implode(' ; ', $errors)];
    }

    /** La clé d'une offre : « bundle-12 ». */
    private static function offerKey(array $offer): string
    {
        return $offer['family'] . '-' . (int) $offer['erpId'];
    }

    /** Le prix d'un produit lu : celui de la boutique de la version, sinon le prix général. */
    private static function priceOf(array $product, ?array $version): ?int
    {
        if ($version === null) {
            return $product['priceCents'] ?? null;
        }
        $mine = $product['prices'][0] ?? null;

        return $mine === null ? null : ($mine['webPriceCents'] ?? $mine['shopPriceCents'] ?? null);
    }

    /** Une remise appliquée à un prix (centimes). */
    private static function discounted(int $price, ?array $reward): ?int
    {
        return match ($reward['type'] ?? null) {
            'percentage' => is_numeric($reward['percent'] ?? null) && $reward['percent'] > 0 ? (int) round($price * (1 - min(100, (float) $reward['percent']) / 100)) : null,
            'amountOff'  => is_int($reward['amountCents'] ?? null) && $reward['amountCents'] > 0 ? max(0, $price - $reward['amountCents']) : null,
            'fixedPrice' => is_int($reward['amountCents'] ?? null) && $reward['amountCents'] < $price ? $reward['amountCents'] : null,
            default      => null,
        };
    }

    private static function pct(float $value): string
    {
        return rtrim(rtrim(number_format($value, 1, ',', ''), '0'), ',');
    }

    /**
     * Le badge et la phrase d'une offre : « Bundle », « 2+1 » (« le 3e offert »), « 3 pour 2 », « −20 % ».
     *
     * @return array{0:string, 1:?string}
     */
    private static function offerTexts(array $offer, string $lang): array
    {
        $nl = $lang === 'nl';
        $m = $offer['mechanic'] ?? [];
        $reward = static function (?array $r): ?string {
            return match ($r['type'] ?? null) {
                'percentage' => is_numeric($r['percent'] ?? null) ? '−' . self::pct((float) $r['percent']) . ' %' : null,
                'amountOff'  => is_int($r['amountCents'] ?? null) ? '−' . self::money($r['amountCents']) : null,
                'fixedPrice' => is_int($r['amountCents'] ?? null) ? self::money($r['amountCents']) : null,
                default      => null,
            };
        };
        switch ($offer['family']) {
            case 'bundle':
                return [$nl ? 'Bundel' : 'Bundle', null];
            case 'buyXGetY':
                $x = $m['buyQuantity'] ?? null;
                $y = $m['getQuantity'] ?? null;
                if (!is_int($x) || !is_int($y) || $x < 1 || $y < 1) {
                    return ['Promo', null];
                }
                $type = $m['reward']['type'] ?? null;
                if ($type === 'free') {
                    $deal = $y === 1 ? ($nl ? 'de ' . ($x + 1) . 'e gratis' : 'le ' . ($x + 1) . 'e offert') : ($nl ? $y . ' gratis' : $y . ' offerts');
                } else {
                    $r = $reward($m['reward'] ?? null);
                    $deal = $r === null ? null : ($nl ? $y . ' aan ' . $r : $y . ' à ' . $r);
                }

                return [$x . '+' . $y, $deal];
            case 'quantity':
                $q = $m['quantity'] ?? null;
                $f = $m['freeQuantity'] ?? null;
                if (($m['mechanism'] ?? null) === 'BUY_X_GET_Y' && is_int($q) && is_int($f) && $q > $f && $f > 0) {
                    return [$nl ? $q . ' voor ' . ($q - $f) : $q . ' pour ' . ($q - $f), null];
                }

                return ['Promo', null];
            default:
                return [$reward($m['reward'] ?? null) ?? 'Promo', null];
        }
    }

    /** La période d'une offre : ses dates, ses jours (« le week-end »), ses heures quand elles sont les mêmes chaque jour. */
    private static function offerPeriod(array $offer, string $lang): ?string
    {
        $nl = $lang === 'nl';
        $parts = [];
        $range = self::rangeText(self::shortDayMonth($offer['validFrom'] ?? null), self::shortDayMonth($offer['validTo'] ?? null), $lang);
        if ($range !== null) {
            $parts[] = $range;
        }
        $schedule = $offer['schedule'] ?? [];
        if ($schedule !== []) {
            $days = array_values(array_unique(array_map(static fn (array $w): int => (int) $w['dayOfWeek'], $schedule)));
            sort($days);
            if ($days === [6, 7]) {
                $parts[] = $nl ? 'in het weekend' : 'le week-end';
            } elseif (count($days) < 7) {
                $names = $nl ? [1 => 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] : [1 => 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
                $parts[] = implode(', ', array_map(static fn (int $d): string => $names[$d], $days));
            }
            $hours = array_values(array_unique(array_map(static fn (array $w): string => $w['from'] . '-' . $w['to'], $schedule)));
            if (count($hours) === 1) {
                [$from, $to] = explode('-', $hours[0]);
                if (!($from === '00:00' && in_array($to, ['23:59', '24:00'], true))) {
                    $h = static fn (string $t): string => (string) preg_replace('/^0?(\d+):(\d{2})$/', $nl ? '$1u$2' : '$1h$2', $t);
                    $parts[] = str_replace([$nl ? 'u00' : 'h00'], [$nl ? 'u' : 'h'], $h($from) . '–' . $h($to));
                }
            }
        }

        return $parts === [] ? null : implode(' · ', $parts);
    }

    /**
     * Une offre telle que l'éditeur et le document la montrent : badge, phrase, période, ses produits (photo, nom,
     * quantité), le prix de l'offre et l'ancien prix quand on les connaît — un bundle : son prix et la somme de ses
     * produits ; un « X achetés = Y » ou une promotion de quantité sur UN produit : le prix des X et celui des X + Y.
     *
     * @param array<int, array<string,mixed>> $known
     * @return array<string,mixed>
     */
    private function offerOut(array $offer, array $known, ?array $version, string $lang): array
    {
        [$badge, $deal] = self::offerTexts($offer, $lang);
        $quantities = [];
        foreach ($offer['products'] ?? [] as $p) {
            $quantities[(int) $p['erpProductId']] ??= is_numeric($p['quantity'] ?? null) ? (float) $p['quantity'] : null;
        }
        $products = [];
        foreach ($offer['knownProductIds'] as $pid) {
            $product = $known[$pid];
            $products[] = [
                'id'       => $pid,
                'name'     => $lang === 'nl' ? $product['nameNl'] : $product['name'],
                'imageUrl' => $product['imageUrl'],
                'quantity' => $quantities[$pid] ?? null,
            ];
        }
        $m = $offer['mechanic'] ?? [];
        $price = null;
        $old = null;
        if ($offer['family'] === 'bundle') {
            $price = $m['priceCents'] ?? null;
            $sum = 0;
            $complete = $products !== [] && count($products) === count($offer['products'] ?? []);
            foreach ($products as $p) {
                $unit = self::priceOf($known[$p['id']], $version);
                if ($unit === null) {
                    $complete = false;
                    break;
                }
                $sum += (int) round($unit * ($p['quantity'] ?? 1));
            }
            $old = $complete && $price !== null && $sum > $price ? $sum : null;
        } elseif (count($products) === 1 && $offer['knownCategoryIds'] === []) {
            $unit = self::priceOf($known[$products[0]['id']], $version);
            $x = $offer['family'] === 'buyXGetY' ? ($m['buyQuantity'] ?? null) : (($m['mechanism'] ?? null) === 'BUY_X_GET_Y' ? ($m['quantity'] ?? null) - ($m['freeQuantity'] ?? 0) : null);
            $y = $offer['family'] === 'buyXGetY' ? (($m['reward']['type'] ?? null) === 'free' ? ($m['getQuantity'] ?? null) : null) : (($m['mechanism'] ?? null) === 'BUY_X_GET_Y' ? ($m['freeQuantity'] ?? null) : null);
            if ($unit !== null && is_int($x) && is_int($y) && $x > 0 && $y > 0) {
                $price = $unit * $x;
                $old = $unit * ($x + $y);
            }
        }

        return [
            'kind'          => 'offer',
            'id'            => self::offerKey($offer),
            'type'          => $offer['family'],
            'erpId'         => (int) $offer['erpId'],
            'name'          => (string) $offer['name'],
            'badge'         => $badge,
            'deal'          => $deal,
            'period'        => self::offerPeriod($offer, $lang),
            'validFrom'     => $offer['validFrom'] ?? null,
            'validTo'       => $offer['validTo'] ?? null,
            'shopScope'     => $offer['shopScope'] ?? 'all',
            'categoryId'    => $offer['categoryId'],
            'productIds'    => $offer['knownProductIds'],
            'categoryIds'   => $offer['knownCategoryIds'],
            'priceCents'    => $price,
            'oldPriceCents' => $old,
            'currency'      => 'EUR',
            'products'      => array_slice($products, 0, self::OFFER_PRODUCTS_SHOWN),
            'moreProducts'  => max(0, count($products) - self::OFFER_PRODUCTS_SHOWN),
        ];
    }

    /** Une offre est-elle cochée ? Le choix enregistré, sinon : touche-t-elle un produit coché ? */
    private static function offerOn(array $offer, array $choices, array $chosenIds, array $chosenCategories): bool
    {
        $key = self::offerKey($offer);
        if (array_key_exists($key, $choices)) {
            return $choices[$key];
        }

        return array_intersect($offer['knownProductIds'], $chosenIds) !== [] || array_intersect($offer['knownCategoryIds'], $chosenCategories) !== [];
    }

    /**
     * La période d'un catalogue, pour ne garder que les promotions valables pendant qu'il circule : celle de sa
     * première gamme datée (l'occurrence en cours ou la prochaine), sinon d'aujourd'hui sans fin. Jamais avant
     * aujourd'hui : une promotion finie ne s'imprime pas.
     *
     * @param array<int, array<string,mixed>> $gammesById
     * @return array{0:string, 1:?string}
     */
    private static function catalogueWindow(array $row, array $gammesById): array
    {
        $today = date('Y-m-d');
        foreach (self::gammeIdsOf($row) as $gid) {
            $from = $gammesById[$gid]['from'] ?? null;
            $to = $gammesById[$gid]['to'] ?? null;
            if (!is_string($from) || !is_string($to) || preg_match('#^(\d{2})/(\d{2})$#', $from, $a) !== 1 || preg_match('#^(\d{2})/(\d{2})$#', $to, $b) !== 1) {
                continue;
            }
            $year = (int) date('Y');
            $start = sprintf('%04d-%s-%s', $year, $a[2], $a[1]);
            $end = sprintf('%04d-%s-%s', $year, $b[2], $b[1]);
            if ($end < $start) {
                $end = sprintf('%04d-%s-%s', $year + 1, $b[2], $b[1]);
            }
            if ($end < $today) {
                $start = sprintf('%04d-%s-%s', $year + 1, $a[2], $a[1]);
                $end = sprintf('%04d-%s', (int) substr($end, 0, 4) + 1, substr($end, 5));
            }

            return [max($today, $start), $end];
        }

        return [$today, null];
    }

    /**
     * Les choix d'offres envoyés : `[{type, id, on}]`, chacune connue de TFBuddy pour ce catalogue (le réseau ou
     * l'une de ses boutiques). TFBuddy muet : les choix sont gardés tels quels (rien à vérifier, rien d'inventé).
     *
     * @return list<array{type:string, id:int, on:bool}>
     */
    private function offerRows(mixed $raw, array $row): array
    {
        if (!is_array($raw) || !array_is_list($raw) || count($raw) > self::OFFERS_MAX) {
            throw new CatalogueError('VALIDATION_FAILED', 'Promotions invalides.', 422, [['field' => 'offers', 'message' => 'Liste de ' . self::OFFERS_MAX . ' promotions au plus attendue.']]);
        }
        $errors = [];
        $out = [];
        foreach ($raw as $index => $item) {
            $field = 'offers[' . $index . ']';
            if (!is_array($item) || array_diff(array_keys($item), ['type', 'id', 'on']) !== []) {
                $errors[] = ['field' => $field, 'message' => 'Forme attendue : {type, id, on}.'];
                continue;
            }
            if (!is_string($item['type'] ?? null) || !in_array($item['type'], self::OFFER_TYPES, true)) {
                $errors[] = ['field' => $field . '.type', 'message' => 'Type : ' . implode(', ', self::OFFER_TYPES) . '.'];
                continue;
            }
            if (!is_int($item['id'] ?? null) || $item['id'] <= 0) {
                $errors[] = ['field' => $field . '.id', 'message' => 'Identifiant de la promotion dans TFBuddy attendu.'];
                continue;
            }
            if (!is_bool($item['on'] ?? null)) {
                $errors[] = ['field' => $field . '.on', 'message' => 'Booléen attendu.'];
                continue;
            }
            $out[$item['type'] . '-' . $item['id']] = ['type' => $item['type'], 'id' => $item['id'], 'on' => $item['on']];
        }
        if ($errors === [] && $out !== []) {
            $data = $this->webshopProducts($this->shopsOf($row));
            $read = $this->webshop->promotions();
            if ($read['error'] === null || $read['offers'] !== []) {
                $knownKeys = array_column($data['offers'], 'id');
                foreach (array_values($out) as $index => $item) {
                    if (!in_array($item['type'] . '-' . $item['id'], $knownKeys, true)) {
                        $errors[] = ['field' => 'offers[' . $index . '].id', 'message' => sprintf('Promotion %s %d inconnue de TFBuddy pour ce catalogue (inactive, finie, ou hors de ses boutiques).', $item['type'], $item['id'])];
                    }
                }
            }
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Promotions invalides.', 422, $errors);
        }

        return array_values($out);
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
            'offers'       => array_values($settings['offers'] ?? []),
            'showAvailability' => (bool) ($settings['showAvailability'] ?? true),
            'pages'        => self::innerPages($settings),
            'productCount' => count(array_filter($settings['products'] ?? [], static fn (array $p): bool => (bool) ($p['on'] ?? false))),
            'pageCount'    => self::pageCountOf($settings),
            'innerPageCount' => self::pageCountOf($settings) - self::BRAND_PAGES,
            'createdAt'    => self::iso((string) $row['created_at']),
            'updatedAt'    => self::iso((string) $row['updated_at']),
        ];
    }

    /**
     * Le nombre de pages d'un catalogue. Un catalogue d'avant les formats (sans `pageCount`, que la
     * migration 049 pose une fois) : le plus petit format qui contient ses pages intérieures + 4.
     */
    public static function pageCountOf(array $settings): int
    {
        $count = $settings['pageCount'] ?? null;
        if (is_int($count) && in_array($count, self::PAGE_COUNTS, true)) {
            return $count;
        }

        return self::smallestFormat(count($settings['pages'] ?? []));
    }

    /** Le plus petit format qui contient `$inner` pages intérieures (16 au-delà). */
    public static function smallestFormat(int $inner): int
    {
        foreach (self::PAGE_COUNTS as $count) {
            if ($inner <= $count - self::BRAND_PAGES) {
                return $count;
            }
        }

        return self::PAGE_COUNTS[count(self::PAGE_COUNTS) - 1];
    }

    /**
     * Les pages intérieures, exactement `pageCount − 4` : une liste plus courte (catalogue d'avant les
     * formats) est complétée de pages vides. Rien n'est jamais retiré en lecture.
     *
     * @return list<array{layout:string, category:?int}>
     */
    public static function innerPages(array $settings): array
    {
        // Ordre des clés fixe (PAGE_KEYS) : MySQL 8 range les clés d'une colonne JSON à sa façon.
        $pages = array_map(
            static fn ($page): array => is_array($page)
                ? array_replace(array_intersect_key(array_fill_keys(self::PAGE_KEYS, null), $page), $page)
                : $page,
            array_values($settings['pages'] ?? []),
        );
        $inner = self::pageCountOf($settings) - self::BRAND_PAGES;
        while (count($pages) < $inner) {
            $pages[] = self::EMPTY_PAGE;
        }

        return $pages;
    }

    private static function pageCountInput(mixed $value, array &$errors): int
    {
        if (!is_int($value) || !in_array($value, self::PAGE_COUNTS, true)) {
            $errors[] = ['field' => 'pageCount', 'message' => 'Nombre de pages : un nombre pair de 8 à 16 — 8, 10, 12, 14 ou 16 (dont 4 pages de la marque).'];

            return self::PAGE_COUNTS[0];
        }

        return $value;
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
        $allowed = ['title', 'source', 'format', 'pageCount', 'langs', 'products', 'pages', 'offers', 'showAvailability'];
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
        $pageCount = self::pageCountInput($input['pageCount'] ?? self::PAGE_COUNTS[0], $errors);
        $langs = self::langs($input['langs'] ?? ['fr'], $errors);
        $shopIds = $owner === 'marque' ? $this->shopIds($input['shopIds'] ?? [], $errors) : [];
        if (array_key_exists('showAvailability', $input) && !is_bool($input['showAvailability'])) {
            $errors[] = ['field' => 'showAvailability', 'message' => 'Booléen attendu.'];
        }
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
            'settings'     => ['langs' => $langs, 'shopIds' => $shopIds, 'pageCount' => $pageCount, 'products' => [], 'pages' => []],
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
        if (array_key_exists('showAvailability', $input)) {
            $row['settings']['showAvailability'] = $input['showAvailability'];
        }
        if (array_key_exists('offers', $input)) {
            $row['settings']['offers'] = $this->offerRows($input['offers'], $row);
        }
        $row['settings']['pages'] = array_key_exists('pages', $input)
            ? $this->pageRows($input['pages'], $pageCount, $row)
            : [];
        $row['settings']['pages'] = $row['settings']['pages'] === []
            ? self::autoPages($row['settings']['products'], $known, $pageCount - self::BRAND_PAGES, $gammeIds)
            : self::pad($row['settings']['pages'], $pageCount);

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
        $allowed = ['title', 'format', 'pageCount', 'langs', 'products', 'pages', 'status', 'printQty', 'offers', 'showAvailability'];
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
        $pageCountBefore = self::pageCountOf($settings);
        $pageCount = array_key_exists('pageCount', $input) ? self::pageCountInput($input['pageCount'], $errors) : $pageCountBefore;
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
        if (array_key_exists('showAvailability', $input)) {
            if (!is_bool($input['showAvailability'])) {
                $errors[] = ['field' => 'showAvailability', 'message' => 'Booléen attendu.'];
            } else {
                $settings['showAvailability'] = $input['showAvailability'];
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

        // Les pages pleines : celles d'un catalogue d'avant les formats sont complétées, jamais coupées.
        $settings['pages'] = self::innerPages($settings);
        $settings['pageCount'] = $pageCount;
        $row['settings'] = $settings;
        if (array_key_exists('offers', $input)) {
            $settings['offers'] = $this->offerRows($input['offers'], $row);
            $row['settings'] = $settings;
        }
        $resize = $pageCount !== $pageCountBefore && !array_key_exists('pages', $input);
        if (array_key_exists('products', $input) || array_key_exists('pages', $input) || array_key_exists('shopIds', $input) || $resize) {
            $known = array_column($this->webshopProducts($this->shopsOf($row))['products'], null, 'id');
            if (array_key_exists('products', $input)) {
                $settings['products'] = $this->productRows($input['products'], $row, $known);
            }
            $row['settings'] = $settings;
            if (array_key_exists('pages', $input)) {
                $settings['pages'] = $this->pageRows($input['pages'], $pageCount, $row);
                $settings['pages'] = $settings['pages'] === []
                    ? self::autoPages($settings['products'], $known, $pageCount - self::BRAND_PAGES, self::gammeIdsOf($row))
                    : self::pad($settings['pages'], $pageCount);
            } elseif ($resize) {
                $settings['pages'] = self::resize($settings['pages'], $pageCount, $settings['products'], $known);
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
     * Les pages intérieures. Une page de produits : `{layout, category}` (catégorie du webshop, ou null :
     * « Notre sélection »), et au choix `gamme` (seulement les produits de cette gamme), `template` (A, B
     * ou C ; absent = A), `filler` (`photo` + `fillerMediaId`, ou `illustration` : ce qui occupe la place
     * libre quand la page n'est pas pleine). Une page de présentation (`presentation`,
     * `presentation_liste`) : sa `gamme` (obligatoire), son `template`, un `text` / `textNl` (400
     * caractères au plus, vide = rien). `pageCount − 4` pages au plus — les pages de la marque ne
     * s'envoient pas. Rangée au plus court : seuls les champs qui ne valent pas leur défaut sont gardés.
     *
     * @param array<string,mixed> $row Le catalogue (propriétaire et boutique : la photo d'une boutique
     *                                 vient de la médiathèque du réseau ou de la sienne).
     * @return list<array<string,mixed>>
     */
    private function pageRows(mixed $raw, int $pageCount, array $row): array
    {
        $inner = $pageCount - self::BRAND_PAGES;
        if (!is_array($raw) || !array_is_list($raw)) {
            throw new CatalogueError('VALIDATION_FAILED', 'Pages invalides.', 422, [['field' => 'pages', 'message' => 'Liste des pages intérieures attendue.']]);
        }
        if (count($raw) > $inner) {
            throw new CatalogueError('VALIDATION_FAILED', 'Trop de pages intérieures.', 422, [['field' => 'pages', 'message' => sprintf(
                'Un catalogue de %d pages a %d pages intérieures (les 4 autres sont celles de la marque) : %d envoyées. Ajoutez des pages (par 2, 16 au plus), ou retirez des pages intérieures.',
                $pageCount, $inner, count($raw))]]);
        }
        $gammes = null;
        $out = [];
        $errors = [];
        foreach ($raw as $index => $page) {
            $field = 'pages[' . $index . ']';
            if (!is_array($page) || array_is_list($page) && $page !== []) {
                $errors[] = ['field' => $field, 'message' => 'Forme attendue : {layout, category, template, gamme, text, textNl, filler, fillerMediaId}.'];
                continue;
            }
            $unknown = array_diff(array_keys($page), self::PAGE_KEYS);
            if ($unknown !== []) {
                $errors[] = ['field' => $field . '.' . reset($unknown), 'message' => 'Champ inconnu.'];
                continue;
            }
            $layout = $page['layout'] ?? null;
            if (!is_string($layout) || !isset(self::LAYOUTS[$layout])) {
                $errors[] = ['field' => $field . '.layout', 'message' => 'Mise en page : ' . implode(', ', array_keys(self::LAYOUTS)) . '.'];
                continue;
            }
            $presentation = in_array($layout, self::PRESENTATIONS, true);
            $category = $page['category'] ?? null;
            if ($category !== null && (!is_int($category) || $category <= 0)) {
                $errors[] = ['field' => $field . '.category', 'message' => 'Identifiant de catégorie du webshop, ou null.'];
            }
            $template = $page['template'] ?? null;
            if ($template !== null && (!is_string($template) || !in_array($template, self::TEMPLATES, true))) {
                $errors[] = ['field' => $field . '.template', 'message' => 'Gabarit : ' . implode(', ', self::TEMPLATES) . '.'];
            }
            $gamme = $page['gamme'] ?? null;
            if ($gamme !== null && (!is_int($gamme) || $gamme <= 0)) {
                $errors[] = ['field' => $field . '.gamme', 'message' => 'Identifiant de gamme du webshop, ou null.'];
                $gamme = null;
            } elseif ($gamme === null && $presentation) {
                $errors[] = ['field' => $field . '.gamme', 'message' => 'Une page de présentation présente une gamme : identifiant de la gamme attendu.'];
            } elseif ($gamme !== null) {
                $gammes ??= array_map(static fn (array $g): int => (int) $g['id'], $this->webshop->gammes()['gammes']);
                if ($gammes !== [] && !in_array($gamme, $gammes, true)) {
                    $errors[] = ['field' => $field . '.gamme', 'message' => sprintf('Gamme %d inconnue ou inactive au webshop.', $gamme)];
                }
            }
            $texts = [];
            foreach (['text', 'textNl'] as $key) {
                $value = $page[$key] ?? '';
                if (!is_string($value) || mb_strlen(trim($value)) > self::PRESENTATION_TEXT_MAX) {
                    $errors[] = ['field' => $field . '.' . $key, 'message' => sprintf('Texte de %d caractères au plus.', self::PRESENTATION_TEXT_MAX)];
                    continue;
                }
                $texts[$key] = trim($value);
            }
            $filler = $page['filler'] ?? null;
            $mediaId = $page['fillerMediaId'] ?? null;
            if ($filler !== null && (!is_string($filler) || !in_array($filler, self::FILLERS, true))) {
                $errors[] = ['field' => $field . '.filler', 'message' => 'Place libre : ' . implode(', ', self::FILLERS) . ', ou null.'];
                $filler = null;
            }
            if ($filler === 'photo') {
                if (!is_int($mediaId) || !$this->catalogueImage($mediaId, $row)) {
                    $errors[] = ['field' => $field . '.fillerMediaId', 'message' => 'Image inconnue de la médiathèque (ou hors de celles que ce catalogue peut prendre).'];
                }
            } elseif ($mediaId !== null) {
                $errors[] = ['field' => $field . '.fillerMediaId', 'message' => 'Seulement avec filler « photo ».'];
            }

            $clean = ['layout' => $layout, 'category' => $presentation ? null : $category];
            if ($template !== null && $template !== self::TEMPLATES[0]) {
                $clean['template'] = $template;
            }
            if ($gamme !== null) {
                $clean['gamme'] = $gamme;
            }
            if ($presentation) {
                foreach ($texts as $key => $value) {
                    if ($value !== '') {
                        $clean[$key] = $value;
                    }
                }
            } elseif ($filler !== null) {
                $clean['filler'] = $filler;
                if ($filler === 'photo') {
                    $clean['fillerMediaId'] = $mediaId;
                }
            }
            $out[] = $clean;
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Pages invalides.', 422, $errors);
        }

        return $out;
    }

    /**
     * Les images de la médiathèque qu'une boutique peut mettre dans la place libre d'une page : celles
     * du réseau et les siennes, pas archivées, les plus récentes d'abord.
     *
     * @return array{items: list<array{id:int, name:string, url:string, thumbnailUrl:?string}>, total:int}
     */
    public function catalogueMedia(int $shopId, string $name, int $page, int $perPage): array
    {
        $filters = ['kind' => 'image', 'shopOrNetwork' => $shopId];
        if ($name !== '') {
            $filters['name'] = $name;
        }
        $result = $this->media->page($filters, 'createdAt', true, $page, $perPage);

        return [
            'items' => array_map(static fn (array $m): array => ['id' => (int) $m['id'], 'name' => $m['name'], 'url' => $m['webUrl'], 'thumbnailUrl' => $m['thumbnailUrl']], $result['items']),
            'total' => $result['total'],
        ];
    }

    /**
     * Une image que ce catalogue peut mettre dans une page : de la médiathèque du Marketing, pas
     * archivée ; pour le catalogue d'une boutique, une image du réseau (sans boutique) ou de la sienne.
     */
    private function catalogueImage(int $mediaId, array $row): bool
    {
        $media = $this->media->find($mediaId);
        if ($media === null || (string) $media['kind'] !== 'image' || $media['archived_at'] !== null) {
            return false;
        }

        return ($row['owner'] ?? 'marque') !== 'boutique' || $media['shop_id'] === null || (int) $media['shop_id'] === (int) $row['shop_id'];
    }

    /** Les gammes d'un catalogue parti de gammes (`source_ref`), dans leur ordre. @return list<int> */
    private static function gammeIdsOf(array $row): array
    {
        return ($row['source_kind'] ?? '') === 'gamme' && ($row['source_ref'] ?? null) !== null
            ? array_values(array_filter(array_map('intval', explode(',', (string) $row['source_ref']))))
            : [];
    }

    /**
     * La répartition automatique, sur exactement `$inner` pages : une catégorie après l'autre (dans
     * l'ordre des produits), en grilles de six, la première page en vedette ; si ça ne tient pas, en
     * listes de douze. Plusieurs gammes : chaque gamme COMMENCE par sa page de présentation, suivie de
     * ses produits par catégorie ; si la place manque, la présentation porte la liste de ses premiers
     * produits (`presentation_liste`), puis les pages passent en listes. Trop peu de produits : les
     * pages restantes sont vides. Trop : le document le dit (`PRODUCTS_OVERFLOW`).
     *
     * @param list<array{id:int, on:bool}> $products
     * @param list<int> $gammeIds Les gammes du catalogue (source), dans leur ordre.
     * @return list<array<string,mixed>>
     */
    public static function autoPages(array $products, array $known, int $inner, array $gammeIds = []): array
    {
        if (count($gammeIds) > 1) {
            $pages = [];
            foreach ([['presentation', false], ['presentation_liste', false], ['presentation_liste', true]] as [$head, $dense]) {
                $pages = self::autoPagesByGamme($products, $known, $gammeIds, $head, $dense);
                if (count($pages) <= $inner) {
                    break;
                }
            }
        } else {
            $pages = self::autoPagesWith($products, $known, false);
            if (count($pages) > $inner) {
                $dense = self::autoPagesWith($products, $known, true);
                if (count($dense) < count($pages)) {
                    $pages = $dense;
                }
            }
        }
        $pages = array_slice($pages, 0, $inner);
        while (count($pages) < $inner) {
            $pages[] = self::EMPTY_PAGE;
        }

        return $pages;
    }

    /** @return list<array{layout:string, category:?int}> */
    private static function autoPagesWith(array $products, array $known, bool $dense): array
    {
        $byCategory = [];
        foreach ($products as $product) {
            if (!$product['on'] || !isset($known[$product['id']])) {
                continue;
            }
            $category = $known[$product['id']]['categoryId'] ?? 0;
            $byCategory[(int) $category] = ($byCategory[(int) $category] ?? 0) + 1;
        }

        return self::categoryPages($byCategory, $dense, true, null);
    }

    /**
     * Les pages d'une suite de catégories (catégorie → nombre de produits) : la première en vedette
     * (si `$featured`), puis des grilles ; en listes si `$dense`.
     *
     * @param array<int,int> $byCategory
     * @return list<array<string,mixed>>
     */
    private static function categoryPages(array $byCategory, bool $dense, bool $featured, ?int $gamme): array
    {
        $pages = [];
        foreach ($byCategory as $category => $count) {
            $left = $count;
            while ($left > 0) {
                $layout = $dense ? 'liste' : ($featured && $pages === [] ? 'vedette' : 'grille');
                $page = ['layout' => $layout, 'category' => $category > 0 ? $category : null];
                if ($gamme !== null) {
                    $page['gamme'] = $gamme;
                }
                $pages[] = $page;
                $left -= self::LAYOUTS[$layout];
            }
        }

        return $pages;
    }

    /**
     * Plusieurs gammes : pour chacune, sa présentation (`$head`) puis ses produits par catégorie. Un
     * produit de deux gammes est rangé dans la première ; ceux d'aucune gamme finissent en « Notre
     * sélection ».
     *
     * @param list<int> $gammeIds
     * @return list<array<string,mixed>>
     */
    private static function autoPagesByGamme(array $products, array $known, array $gammeIds, string $head, bool $dense): array
    {
        $byGamme = array_fill_keys($gammeIds, []);
        $others = [];
        foreach ($products as $product) {
            if (!$product['on'] || !isset($known[$product['id']])) {
                continue;
            }
            $own = array_map('intval', $known[$product['id']]['gammes'] ?? []);
            $category = (int) ($known[$product['id']]['categoryId'] ?? 0);
            $placed = false;
            foreach ($gammeIds as $gid) {
                if (in_array($gid, $own, true)) {
                    $byGamme[$gid][] = $category;
                    $placed = true;
                    break;
                }
            }
            if (!$placed) {
                $others[$category] = ($others[$category] ?? 0) + 1;
            }
        }
        $pages = [];
        foreach ($byGamme as $gid => $categories) {
            $pages[] = ['layout' => $head, 'category' => null, 'gamme' => $gid];
            // La présentation avec liste porte les premiers produits de la gamme.
            $rest = array_slice($categories, self::LAYOUTS[$head]);
            $counts = [];
            foreach ($rest as $category) {
                $counts[$category] = ($counts[$category] ?? 0) + 1;
            }
            $pages = array_merge($pages, self::categoryPages($counts, $dense, false, $gid));
        }
        if ($others !== []) {
            $pages = array_merge($pages, self::categoryPages($others, $dense, false, null));
        }

        return $pages;
    }

    /** @param list<array<string,mixed>> $pages @return list<array<string,mixed>> */
    private static function pad(array $pages, int $pageCount): array
    {
        while (count($pages) < $pageCount - self::BRAND_PAGES) {
            $pages[] = self::EMPTY_PAGE;
        }

        return $pages;
    }

    /**
     * Change le nombre de pages sans liste de pages : des pages vides s'ajoutent à la fin ; en
     * réduisant, seules des pages de la fin SANS produit ni présentation sont retirées. Une page qui en
     * porte n'est jamais retirée en silence : 422 `CATALOGUE_PAGES_NOT_EMPTY`, page par page — on
     * renvoie alors `pages` (la liste voulue), ou « Répartir automatiquement » (`pages: []`).
     *
     * @param list<array<string,mixed>> $pages
     * @param list<array{id:int, on:bool}> $products
     * @return list<array<string,mixed>>
     */
    private static function resize(array $pages, int $pageCount, array $products, array $known): array
    {
        $inner = $pageCount - self::BRAND_PAGES;
        if (count($pages) <= $inner) {
            return self::pad($pages, $pageCount);
        }
        $chosen = [];
        foreach ($products as $item) {
            if (($item['on'] ?? false) && isset($known[$item['id']])) {
                $chosen[] = ['id' => $item['id'], 'categoryId' => $known[$item['id']]['categoryId'] ?? null, 'gammes' => $known[$item['id']]['gammes'] ?? []];
            }
        }
        $filled = self::fill($pages, $chosen)['items'];
        $details = [];
        for ($i = $inner; $i < count($pages); $i++) {
            if ($filled[$i] !== []) {
                $details[] = ['field' => 'pages[' . $i . ']', 'message' => sprintf('La page %d porte %d produit(s).', $i + 3, count($filled[$i]))];
            } elseif (in_array($pages[$i]['layout'], self::PRESENTATIONS, true)) {
                $details[] = ['field' => 'pages[' . $i . ']', 'message' => sprintf('La page %d présente une gamme.', $i + 3)];
            }
        }
        if ($details !== []) {
            throw new CatalogueError('CATALOGUE_PAGES_NOT_EMPTY', sprintf(
                'Passer à %d pages retirerait des pages qui portent des produits : réordonnez les pages, changez leur mise en page, ou répartissez automatiquement.', $pageCount), 422, $details);
        }

        return array_slice($pages, 0, $inner);
    }

    /**
     * Range les produits choisis dans les pages, dans l'ordre : chaque page prend ceux de sa catégorie
     * et de sa gamme (quand elle en a) ; « Notre sélection » (ni catégorie ni gamme) prend ceux qui
     * restent, toutes catégories ; une présentation avec liste prend les premiers de sa gamme, une
     * présentation seule aucun.
     *
     * @param list<array<string,mixed>> $pages
     * @param list<array<string,mixed>> $chosen Produits avec leur `categoryId` (et leurs `gammes`).
     * @return array{items: list<list<array<string,mixed>>>, left:int}
     */
    public static function fill(array $pages, array $chosen): array
    {
        // L'ordre de rangement : par catégorie (dans l'ordre où elles apparaissent), puis l'ordre des produits.
        $rank = [];
        foreach ($chosen as $product) {
            $rank[(int) ($product['categoryId'] ?? 0)] ??= count($rank);
        }
        $order = array_keys($chosen);
        usort($order, static fn (int $a, int $b): int => [$rank[(int) ($chosen[$a]['categoryId'] ?? 0)], $a] <=> [$rank[(int) ($chosen[$b]['categoryId'] ?? 0)], $b]);
        $placed = [];
        $out = [];
        foreach ($pages as $page) {
            $capacity = self::LAYOUTS[$page['layout']] ?? 6;
            $category = $page['category'] ?? null;
            $gamme = $page['gamme'] ?? null;
            $items = [];
            // Une présentation avec liste : les premiers produits de sa gamme, dans l'ordre du catalogue.
            foreach (in_array($page['layout'], self::PRESENTATIONS, true) ? array_keys($chosen) : $order as $key) {
                if (count($items) >= $capacity) {
                    break;
                }
                if (isset($placed[$key])) {
                    continue;
                }
                $product = $chosen[$key];
                // Une offre (vignette promotion) va sur une page de produits, jamais dans la liste d'une présentation.
                if (isset($product['offer']) && in_array($page['layout'], self::PRESENTATIONS, true)) {
                    continue;
                }
                if ($category !== null && (int) ($product['categoryId'] ?? 0) !== $category) {
                    continue;
                }
                if ($gamme !== null && !in_array($gamme, array_map('intval', $product['gammes'] ?? []), true)) {
                    continue;
                }
                $placed[$key] = true;
                $items[] = $product;
            }
            $out[] = $items;
        }

        return ['items' => $out, 'left' => count($chosen) - count($placed)];
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
            'page2'       => array_replace($default['page2'], array_intersect_key((array) ($saved['page2'] ?? []), $default['page2'])),
            'penultimate' => array_replace($default['penultimate'], array_intersect_key((array) ($saved['penultimate'] ?? []), $default['penultimate'])),
            'updatedAt'   => isset(Config::all()[self::CHARTER_VARIABLE]) ? self::iso(Config::all()[self::CHARTER_VARIABLE]['updated_at']) : null,
        ];
        $out['logoUrl'] = $this->mediaUrl($out['logoMediaId']);
        foreach ($out['covers'] as &$cover) {
            $cover['imageUrl'] = $this->mediaUrl($cover['mediaId']);
        }
        unset($cover);
        foreach (['page2', 'penultimate'] as $slot) {
            $out[$slot]['mediaId'] = is_int($out[$slot]['mediaId']) ? $out[$slot]['mediaId'] : null;
            $out[$slot]['imageUrl'] = $this->mediaUrl($out[$slot]['mediaId']);
        }

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
            // Page 2 et avant-dernière : des textes à adapter par la marque, sans prix ni promesse chiffrée.
            'page2'       => [
                'titleFr' => 'Fait maison chaque matin',
                'titleNl' => 'Elke ochtend huisgemaakt',
                'textFr'  => "Chaque jour, nos boulangers et nos pâtissiers préparent dans notre atelier les pains, les viennoiseries et les pâtisseries que vous retrouvez en boutique.\n\nVoici notre sélection du moment : bonne découverte !",
                'textNl'  => "Elke dag bereiden onze bakkers en patissiers in ons atelier de broden, de viennoiserie en het gebak die u in de winkel terugvindt.\n\nHier is onze selectie van het moment: veel ontdekplezier!",
                'mediaId' => null,
            ],
            'penultimate' => [
                'titleFr' => 'Nos services',
                'titleNl' => 'Onze diensten',
                'textFr'  => "Commande en ligne sur notre webshop\nRetrait en boutique\nLivraison\nGâteaux sur commande pour vos fêtes et vos événements",
                'textNl'  => "Online bestellen via onze webshop\nAfhalen in de winkel\nLevering\nTaarten op bestelling voor uw feesten en evenementen",
                'mediaId' => null,
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
        $errors = self::unknown($input, ['logoMediaId', 'colors', 'covers', 'back', 'page2', 'penultimate']);
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

        // Page 2 et avant-dernière : un titre, un texte (paragraphes), une image de la médiathèque.
        // Absentes du corps : celles déjà enregistrées (ou les défauts) restent.
        $current = $this->charter();
        $brandPages = [];
        foreach (['page2', 'penultimate'] as $slot) {
            $raw = $input[$slot] ?? array_intersect_key($current[$slot], $default[$slot]);
            if (!is_array($raw)) {
                $errors[] = ['field' => $slot, 'message' => 'Objet {titleFr, titleNl, textFr, textNl, mediaId} attendu.'];
                $raw = $default[$slot];
            }
            $errors = array_merge($errors, self::unknown($raw, array_keys($default[$slot]), $slot . '.'));
            $media = $raw['mediaId'] ?? null;
            if ($media !== null && (!is_int($media) || $this->media->find($media) === null)) {
                $errors[] = ['field' => $slot . '.mediaId', 'message' => 'Fichier inconnu de la médiathèque.'];
            }
            $clean = [];
            foreach (['titleFr', 'titleNl'] as $text) {
                $clean[$text] = self::text($raw[$text] ?? '', $slot . '.' . $text, $errors);
            }
            foreach (['textFr', 'textNl'] as $text) {
                $clean[$text] = self::text($raw[$text] ?? '', $slot . '.' . $text, $errors, self::PAGE_TEXT_MAX);
            }
            if ($clean['titleFr'] === '' && $clean['textFr'] === '') {
                $errors[] = ['field' => $slot . '.titleFr', 'message' => 'Un titre ou un texte français est obligatoire : la page s’imprime dans chaque catalogue.'];
            }
            $clean['mediaId'] = $media;
            $brandPages[$slot] = $clean;
        }

        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Charte des catalogues invalide.', 422, $errors);
        }

        Config::put(self::CHARTER_VARIABLE, [
            'logoMediaId' => $logo,
            'colors'      => array_replace($default['colors'], $colors),
            'covers'      => $covers,
            'back'        => $cleanBack,
            'page2'       => $brandPages['page2'],
            'penultimate' => $brandPages['penultimate'],
        ], 'marketing', $userId, 'Charte des catalogues : logo, couvertures par gamme, page 2, avant-dernière et dernière pages, couleurs.');

        return $this->charter();
    }

    private static function text(mixed $value, string $field, array &$errors, int $max = self::TEXT_MAX): string
    {
        if (!is_string($value) || mb_strlen($value) > $max) {
            $errors[] = ['field' => $field, 'message' => 'Texte de ' . $max . ' caractères au plus.'];

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
                'kind'          => 'product',
                'id'            => $product['id'],
                'name'          => $lang === 'nl' ? $product['nameNl'] : $product['name'],
                'imageUrl'      => $product['imageUrl'],
                'categoryId'    => $product['categoryId'],
                'gammes'        => $product['gammes'],
                'priceCents'    => $price,
                'oldPriceCents' => null,
                'promo'         => null,
                'currency'      => 'EUR',
                'availability'  => ($row['settings']['showAvailability'] ?? true) ? self::availabilityText($product['availability'] ?? [], self::gammeIdsOf($row), $lang) : null,
            ];
        }

        // Les promotions (bundles, « X achetés = Y », quantité, remises programmées) : celles du réseau (version
        // générale) ou de la boutique de la version, valables pendant que le catalogue circule, cochées.
        $offers = $this->offersFor($known, $version !== null ? array_values(array_filter([$version['erpShopId']])) : [], $version === null,
            self::catalogueWindow($row, array_column($data['gammes'], null, 'id')));
        if ($offers['error'] !== null) {
            $warnings[] = ['code' => 'PROMOTIONS_UNREADABLE', 'message' => 'Promotions et bundles de TFBuddy illisibles (' . $offers['error'] . ') : le catalogue n’en montre aucune et aucun prix n’est barré.'];
        }
        $choices = [];
        foreach ($row['settings']['offers'] ?? [] as $choice) {
            $choices[$choice['type'] . '-' . (int) $choice['id']] = (bool) $choice['on'];
        }
        $chosenIds = array_column($chosen, 'id');
        $chosenCategories = array_values(array_unique(array_filter(array_map(static fn (array $c): int => (int) ($c['categoryId'] ?? 0), $chosen))));
        foreach ($offers['offers'] as $offer) {
            if (!self::offerOn($offer, $choices, $chosenIds, $chosenCategories)) {
                continue;
            }
            if ($offer['family'] === 'scheduledDiscount') {
                // Une remise programmée barre le prix des produits qu'elle vise.
                [$label] = self::offerTexts($offer, $lang);
                foreach ($chosen as &$item) {
                    if (($item['priceCents'] ?? null) === null || !(in_array($item['id'], $offer['knownProductIds'], true) || in_array((int) ($item['categoryId'] ?? 0), $offer['knownCategoryIds'], true))) {
                        continue;
                    }
                    $original = $item['oldPriceCents'] ?? $item['priceCents'];
                    $new = self::discounted($original, $offer['mechanic']['reward'] ?? null);
                    if ($new !== null && $new < $original && $new < $item['priceCents']) {
                        $item['oldPriceCents'] = $original;
                        $item['priceCents'] = $new;
                        $item['promo'] = ['label' => $label, 'period' => self::offerPeriod($offer, $lang)];
                    }
                }
                unset($item);
                continue;
            }
            // Une vignette : elle occupe une case de la page de sa catégorie, devant ses produits.
            $out = $this->offerOut($offer, $known, $version, $lang);
            $gammes = [];
            foreach ($offer['knownProductIds'] as $pid) {
                $gammes = array_merge($gammes, $known[$pid]['gammes'] ?? []);
            }
            $vignette = ['id' => $out['id'], 'categoryId' => $offer['categoryId'], 'gammes' => array_values(array_unique($gammes)), 'offer' => array_diff_key($out, ['productIds' => true, 'categoryIds' => true, 'categoryId' => true, 'shopScope' => true])];
            $at = count($chosen);
            foreach ($chosen as $i => $item) {
                if ((int) ($item['categoryId'] ?? 0) === (int) $offer['categoryId']) {
                    $at = $i;
                    break;
                }
            }
            array_splice($chosen, $at, 0, [$vignette]);
        }
        if ($absent !== []) {
            $warnings[] = ['code' => 'PRODUCT_NOT_SOLD', 'message' => sprintf('%d produit(s) coché(s) absent(s) du webshop%s : retiré(s) de cette version.',
                count($absent), $version !== null ? ' de ' . $version['name'] : '')];
        }

        // Les pages intérieures : chaque page prend les produits de sa catégorie (et de sa gamme), dans
        // l'ordre ; une page de présentation montre sa gamme, son illustration et, au choix, sa liste.
        $charter = $this->charter();
        $gammesById = array_column($data['gammes'], null, 'id');
        $catalogueGammes = self::gammeIdsOf($row);
        $innerRows = self::innerPages($row['settings']);
        $filled = self::fill($innerRows, $chosen);
        $inner = [];
        $empty = 0;
        $strip = static fn (array $p): array => $p['offer'] ?? array_diff_key($p, ['categoryId' => true, 'gammes' => true]);
        foreach ($innerRows as $index => $page) {
            $items = $filled['items'][$index];
            $no = $index + 3;
            $template = in_array($page['template'] ?? null, self::TEMPLATES, true) ? $page['template'] : self::TEMPLATES[0];
            $gid = isset($page['gamme']) ? (int) $page['gamme'] : null;
            $visual = $gid !== null ? $this->gammeVisual($gid, $gammesById, $charter, $lang) : null;
            if ($visual !== null && !$visual['known']) {
                $warnings[] = ['code' => 'GAMME_UNKNOWN', 'message' => sprintf('Page %d : la gamme %d n’est plus active au webshop.', $no, $gid)];
            }
            if (in_array($page['layout'], self::PRESENTATIONS, true)) {
                $text = (string) ($page['text'] ?? '');
                $textNl = (string) ($page['textNl'] ?? '');
                if ($lang === 'nl' && $textNl === '' && $text !== '') {
                    $warnings[] = ['code' => 'NL_TEXT_MISSING', 'message' => sprintf('Page %d : texte néerlandais de la présentation à écrire — le français est imprimé.', $no)];
                }
                if ($visual !== null && $visual['imageUrl'] === null && $visual['drawing'] === null) {
                    $warnings[] = ['code' => 'GAMME_NO_ILLUSTRATION', 'message' => sprintf('Page %d : pas d’illustration pour la gamme « %s » (ni visuel dans la Charte des catalogues, ni photo au webshop, ni dessin de saison) : un cadre sobre est imprimé.', $no, $visual['title'])];
                }
                $inner[] = [
                    'kind'       => 'presentation',
                    'locked'     => false,
                    'layout'     => $page['layout'],
                    'template'   => $template,
                    'gamme'      => $gid,
                    'title'      => $visual['title'] ?? '',
                    'text'       => $lang === 'nl' ? ($textNl !== '' ? $textNl : $text) : $text,
                    'imageUrl'   => $visual['imageUrl'] ?? null,
                    'drawing'    => $visual['drawing'] ?? null,
                    'drawingUrl' => $visual['drawingUrl'] ?? null,
                    'products'   => $page['layout'] === 'presentation_liste' ? array_map($strip, $items) : [],
                ];
                continue;
            }
            if ($items === []) {
                $empty++;
            }
            $category = $page['category'] !== null ? ($categories[$page['category']] ?? null) : null;
            $title = $category !== null ? ($lang === 'nl' ? $category['nameNl'] : $category['name']) : ($visual !== null ? $visual['title'] : ($lang === 'nl' ? 'Onze selectie' : 'Notre sélection'));
            // Page sans catégorie : ses produits sont rangés par catégorie et le titre dit lesquelles
            // (« Cougnou · Noël »), trois au plus ; au-delà, le titre de la gamme ou « Notre sélection ».
            if ($category === null && $items !== []) {
                $order = [];
                foreach ($items as $item) {
                    $order[(int) ($item['categoryId'] ?? 0)] ??= count($order);
                }
                usort($items, static fn (array $a, array $b): int => $order[(int) ($a['categoryId'] ?? 0)] <=> $order[(int) ($b['categoryId'] ?? 0)]);
                $names = [];
                foreach (array_keys($order) as $cid) {
                    $c = $categories[$cid] ?? null;
                    if ($c !== null) {
                        $names[] = $lang === 'nl' ? $c['nameNl'] : $c['name'];
                    }
                }
                if ($names !== [] && count($names) === count($order) && count($names) <= 3) {
                    $title = implode(' · ', $names);
                }
            }
            $capacity = self::LAYOUTS[$page['layout']];
            $room = max(0, $capacity - count($items));
            $fillable = self::fillable($page['layout'], count($items));
            // La place libre : une photo de la médiathèque, ou l'illustration de la gamme (celle de la page,
            // sinon la première du catalogue), à défaut celle de la famille de la catégorie.
            $filler = null;
            if ($fillable && ($page['filler'] ?? null) === 'photo') {
                $media = isset($page['fillerMediaId']) ? $this->media->find((int) $page['fillerMediaId']) : null;
                if ($media === null || $media['archived_at'] !== null) {
                    $warnings[] = ['code' => 'FILLER_MEDIA_MISSING', 'message' => sprintf('Page %d : la photo choisie pour la place libre n’est plus dans la médiathèque.', $no)];
                } else {
                    $filler = ['kind' => 'photo', 'imageUrl' => (string) $this->media->serialize($media)['webUrl'], 'drawing' => null, 'drawingUrl' => null];
                }
            } elseif ($fillable && ($page['filler'] ?? null) === 'illustration') {
                $source = $visual ?? (isset($catalogueGammes[0]) ? $this->gammeVisual($catalogueGammes[0], $gammesById, $charter, $lang) : null);
                $family = $category !== null ? self::familyDrawing((string) $category['name']) : null;
                $drawing = $source['drawing'] ?? $family;
                $imageUrl = $source['imageUrl'] ?? null;
                if ($drawing === null && $imageUrl === null) {
                    $warnings[] = ['code' => 'FILLER_NO_ILLUSTRATION', 'message' => sprintf('Page %d : pas d’illustration pour cette gamme ni pour cette catégorie : la place reste libre.', $no)];
                } else {
                    $filler = ['kind' => 'illustration', 'imageUrl' => $drawing === null ? $imageUrl : null, 'drawing' => $drawing, 'drawingUrl' => $drawing === null ? null : MediaService::publicUrl($drawing)];
                }
            }
            $inner[] = [
                'kind'       => 'products',
                'locked'     => false,
                'layout'     => $page['layout'],
                'template'   => $template,
                'category'   => $page['category'],
                'gamme'      => $gid,
                'title'      => $title,
                // Le rappel de la gamme dans l'en-tête : son dessin, au trait.
                'drawing'    => $visual['drawing'] ?? null,
                'drawingUrl' => $visual['drawingUrl'] ?? null,
                'room'       => $room,
                'fillable'   => $fillable,
                'filler'     => $filler,
                'products'   => array_map($strip, $items),
            ];
        }
        $left = $filled['left'];
        $pageCount = self::pageCountOf($row['settings']);
        if ($left > 0) {
            $warnings[] = ['code' => 'PRODUCTS_OVERFLOW', 'message' => sprintf('%d produit(s) sans place : %schoisissez une mise en page plus dense (liste) ou retirez des produits.',
                $left, $pageCount < 16 ? 'ajoutez 2 pages (' . ($pageCount + 2) . ' pages), ' : '')];
        }
        if ($empty > 0) {
            $warnings[] = ['code' => 'PAGES_EMPTY', 'message' => sprintf('%d page(s) intérieure(s) sans produit : ajoutez des produits, changez la catégorie de la page ou passez à un catalogue plus court.', $empty)];
        }
        if (count($innerRows) > $pageCount - self::BRAND_PAGES) {
            $warnings[] = ['code' => 'PAGES_OVER_FORMAT', 'message' => sprintf('Catalogue d’avant les formats : %d pages intérieures pour %d pages. Répartissez à nouveau pour revenir au format.', count($innerRows), $pageCount)];
        }

        // Couverture et dernière page : la charte, verrouillées.
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

        // Page 2 et avant-dernière : la charte, verrouillées.
        $brand = [];
        foreach (['page2', 'penultimate'] as $slot) {
            $content = $charter[$slot];
            if ($lang === 'nl' && (($content['titleNl'] === '' && $content['titleFr'] !== '') || ($content['textNl'] === '' && $content['textFr'] !== ''))) {
                $warnings[] = ['code' => 'NL_TEXT_MISSING', 'message' => sprintf('%s néerlandaise à écrire dans la Charte des catalogues : le français est imprimé.', $slot === 'page2' ? 'Page 2' : 'Avant-dernière page')];
            }
            $brand[$slot] = [
                'kind'     => 'brand',
                'locked'   => true,
                'slot'     => $slot,
                'title'    => $lang === 'nl' ? ($content['titleNl'] ?: $content['titleFr']) : $content['titleFr'],
                'text'     => $lang === 'nl' ? ($content['textNl'] ?: $content['textFr']) : $content['textFr'],
                'imageUrl' => $content['imageUrl'],
            ];
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
            [$brand['page2']],
            $inner,
            [$brand['penultimate']],
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
            'catalogue' => ['id' => (int) $row['id'], 'title' => (string) $row['title'], 'format' => (string) $row['format'], 'owner' => (string) $row['owner'], 'pageCount' => $pageCount],
            'version'   => ['shop' => $shopInfo, 'lang' => $lang],
            'charter'   => ['logoUrl' => $charter['logoUrl'], 'colors' => $charter['colors']],
            'pages'     => $pages,
            'warnings'  => array_values(array_unique($warnings, SORT_REGULAR)),
        ];
    }

    /**
     * Une page de produits a-t-elle une place libre qu'une photo ou une illustration peut prendre ?
     * Une rangée entière au moins (grille 2 × 3 : 4 produits au plus ; vedette : la vedette et 2 au
     * plus), ou trois lignes de liste ; une page sans produit, toujours.
     */
    public static function fillable(string $layout, int $count): bool
    {
        return match ($layout) {
            'grille'  => $count <= 4,
            'vedette' => $count <= 3,
            'liste'   => $count <= 9,
            default   => false,
        };
    }

    /**
     * Une gamme telle qu'une page la montre : son nom (celui de sa couverture dans la charte, sinon
     * le webshop, sans emoji ni « Gamme »), sa photo (visuel de sa couverture dans la charte, sinon
     * la photo du webshop) et son dessin de saison (les illustrations livrées avec le module,
     * `img/print/`). Rien n'est inventé : sans aucun des trois, la page imprime un cadre sobre.
     *
     * @return array{title:string, imageUrl:?string, drawing:?string, drawingUrl:?string, known:bool}
     */
    private function gammeVisual(int $gid, array $gammesById, array $charter, string $lang): array
    {
        $gamme = $gammesById[$gid] ?? null;
        $cover = null;
        foreach ($charter['covers'] ?? [] as $candidate) {
            if ($candidate['gamme'] === $gid) {
                $cover = $candidate;
            }
        }
        $name = $gamme !== null ? (string) $gamme['name'] : '';
        $title = $cover !== null ? ($lang === 'nl' ? ($cover['titleNl'] ?: $cover['titleFr']) : $cover['titleFr']) : self::gammeLabel($name);
        if ($title === '') {
            $title = ($lang === 'nl' ? 'Gamma ' : 'Gamme ') . $gid;
        }
        $slug = self::seasonSlug($name) ?? ($cover !== null ? self::seasonSlug((string) $cover['titleFr']) : null);
        $drawing = $slug !== null ? 'img/print/' . $slug . '.png' : null;

        return [
            'title'      => $title,
            'imageUrl'   => ($cover['imageUrl'] ?? null) ?? ($gamme['image'] ?? null),
            'drawing'    => $drawing,
            'drawingUrl' => $drawing !== null ? MediaService::publicUrl($drawing) : null,
            'known'      => $gamme !== null,
        ];
    }

    /** Le nom court d'une gamme : sans emoji de tête, préfixe « Gamme », parenthèses (comme `seasonLabel` de l'écran). */
    private static function gammeLabel(string $name): string
    {
        $clean = (string) preg_replace('/^[^\p{L}\p{N}]+/u', '', $name);
        $clean = (string) preg_replace('/^Icône\s*[-–]\s*/iu', '', $clean);
        $clean = (string) preg_replace('/^Gamme\s+/iu', '', $clean);
        $clean = (string) preg_replace('/\s*\(.*\)\s*$/u', '', $clean);
        $clean = trim((string) preg_split('/\s+[–—]\s+/u', $clean)[0]);

        return $clean !== '' ? $clean : trim($name);
    }

    /** Forme comparable d'un libellé : minuscules, sans accent ni ponctuation. */
    private static function compact(string $value): string
    {
        $flat = mb_strtolower($value);
        $flat = strtr($flat, ['à' => 'a', 'â' => 'a', 'ä' => 'a', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ç' => 'c', 'œ' => 'oe']);

        return (string) preg_replace('/[^a-z0-9]/', '', $flat);
    }

    /** Le dessin de saison d'une gamme (`img/print/<saison>.png`), reconnu au mot-clé de son nom — la règle de `seasonImage`. */
    private static function seasonSlug(string $name): ?string
    {
        $flat = self::compact($name);
        foreach ([['printan', 'printemps'], ['estival', 'ete'], ['automn', 'automne'], ['hivern', 'hiver'], ['noel', 'noel'], ['nicolas', 'saint-nicolas'],
            ['epiphanie', 'epiphanie'], ['mere', 'fete-des-meres'], ['pascal', 'paques'], ['paque', 'paques'], ['valentin', 'saint-valentin'],
            ['chandeleur', 'chandeleur'], ['glace', 'glace'], ['b2b', 'b2b']] as [$key, $slug]) {
            if ($flat !== '' && str_contains($flat, $key)) {
                return $slug;
            }
        }

        return null;
    }

    /** Le dessin d'une famille de produits (`img/<dessin>.png`), d'après le nom de la catégorie — la règle de `familyImage`. */
    private static function familyDrawing(string $category): ?string
    {
        $flat = self::compact($category);
        foreach ([['tarte', 'sweet-tart-small'], ['patisserie', 'cake-slice'], ['viennoiserie', 'croissant'], ['pain', 'bread-1'], ['boulangerie', 'rolls'],
            ['salade', 'salads'], ['plat', 'salads'], ['traiteur', 'salads'], ['biscuit', 'cookies'], ['cookie', 'cookies'], ['quiche', 'savoury-tart'],
            ['snack', 'savoury-tart']] as [$key, $file]) {
            if ($flat !== '' && str_contains($flat, $key)) {
                return 'img/' . $file . '.png';
            }
        }

        return null;
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
