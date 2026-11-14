<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
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
 *  - `GET /api/v1/product-availability-periods` — les gammes actives ;
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

    /** Lectures déjà faites pendant la requête. @var array<string, array{data:array<mixed>, error:?string}> */
    private array $memo = [];

    public function __construct(private readonly ErpClient $erp = new ErpClient())
    {
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
            $fr = ErpClient::rows($this->erp->get('/api/v1/shops/' . $erpShopId . '/products/available', ['lang_code' => 'fr'] + $query));
            $nl = [];
            $nlCats = [];
            try {
                foreach (ErpClient::rows($this->erp->get('/api/v1/shops/' . $erpShopId . '/products/available', ['lang_code' => 'nl'] + $query)) as $row) {
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
                foreach ((array) ($row['availability_periods'] ?? []) as $period) {
                    if (is_array($period) && !empty($period['id'])) {
                        $gammes[] = (int) $period['id'];
                    }
                }
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
                ];
            }

            return $products;
        });

        return ['products' => $read['data'], 'error' => $read['error'], 'readAt' => $read['readAt']];
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
            foreach (ErpClient::rows($this->erp->get('/api/v1/product-availability-periods', ['lang_code' => 'fr'])) as $row) {
                if (empty($row['id']) || empty($row['is_active'])) {
                    continue;
                }
                // « 🎄 Gamme Noël » → « Gamme Noël » : un emoji en tête ne s'imprime pas.
                $name = trim((string) preg_replace('/^[^\p{L}\p{N}]+/u', '', (string) ($row['name'] ?? '')));
                $out[] = [
                    'id'    => (int) $row['id'],
                    'name'  => $name,
                    'image' => self::image($row['photo'] ?? null),
                    'from'  => isset($row['from_md']) ? sprintf('%02d/%02d', (int) $row['from_md'] % 100, intdiv((int) $row['from_md'], 100)) : null,
                    'to'    => isset($row['to_md']) ? sprintf('%02d/%02d', (int) $row['to_md'] % 100, intdiv((int) $row['to_md'], 100)) : null,
                ];
            }
            usort($out, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

            return $out;
        });

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
                    foreach (ErpClient::rows($this->erp->get($path), ['shops']) as $row) {
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
