<?php

declare(strict_types=1);

namespace Marketing\Service;

use DateTimeImmutable;
use DateTimeZone;
use Marketing\Repository\MediaRepository;
use Marketing\Support\Config;
use Marketing\Support\MediaStore;
use Marketing\Support\Session;

/**
 * Les règles de la médiathèque commune.
 *
 * - Un fichier n'est gardé qu'une fois : le même fichier redéposé (même
 *   empreinte) rend la fiche existante, remise dans la médiathèque si elle en
 *   avait été retirée — ses classements ne sont pas écrasés.
 * - Retirer un fichier ne l'efface pas du disque : un post publié, une campagne
 *   ou une brochure peuvent encore pointer dessus.
 * - Les classements (catégorie, sous-catégorie, saison, produit, boutique)
 *   doivent exister ; une sous-catégorie doit appartenir à la catégorie donnée.
 */
final class MediaService
{
    public const NAME_MAX = 200;

    public function __construct(private readonly MediaRepository $media = new MediaRepository())
    {
    }

    /**
     * Dépose un fichier.
     *
     * @param array<string,mixed> $fields Classements déjà lus (`validateFields`).
     * @return array{media:array<string,mixed>, duplicate:bool}
     */
    public function create(string $binary, array $fields, ?string $poster, int $userId): array
    {
        $info = MediaStore::inspect($binary);

        $existing = $this->media->findBySha($info['sha256']);
        if ($existing !== null) {
            if ($existing['archived_at'] !== null) {
                $this->media->setArchived((int) $existing['id'], false);
                $existing = $this->media->find((int) $existing['id']) ?? $existing;
            }

            return ['media' => $this->serialize($existing), 'duplicate' => true];
        }

        $paths = MediaStore::write($binary, $info, $poster);
        $id = $this->media->insert([
            'kind'             => $info['kind'],
            'file_path'        => $paths['path'],
            'thumb_path'       => $paths['thumb_path'],
            'web_path'         => $paths['web_path'],
            'mime'             => $info['mime'],
            'bytes'            => $info['bytes'],
            'width'            => $info['width'],
            'height'           => $info['height'],
            'sha256'           => $info['sha256'],
            'name'             => $fields['name'] ?? ($info['kind'] === 'video' ? 'Vidéo' : 'Photo'),
            'category_code'    => $fields['category_code'] ?? null,
            'subcategory_code' => $fields['subcategory_code'] ?? null,
            'season_code'      => $fields['season_code'] ?? null,
            'offer_item_id'    => $fields['offer_item_id'] ?? null,
            'shop_id'          => $fields['shop_id'] ?? null,
            'cutout'           => (int) ($fields['cutout'] ?? 0),
            'source'           => $fields['source'] ?? 'marketing',
            'created_by'       => $userId > 0 ? $userId : null,
        ]);

        return ['media' => $this->serialize((array) $this->media->find($id)), 'duplicate' => false];
    }

    /**
     * Lit et contrôle les champs d'une fiche. Rend les colonnes à écrire et les
     * erreurs, champ par champ ; une seule erreur refuse l'envoi entier.
     *
     * @param array<string,mixed> $input  Champs reçus (camelCase).
     * @param array<string,mixed> $current La fiche actuelle, pour une modification.
     * @return array{fields:array<string,mixed>, errors:list<array{field:string, message:string}>}
     */
    public function validateFields(array $input, array $current = []): array
    {
        $fields = [];
        $errors = [];
        $fail = static function (string $field, string $message) use (&$errors): void {
            $errors[] = ['field' => $field, 'message' => $message];
        };

        if (array_key_exists('name', $input)) {
            $name = trim((string) $input['name']);
            if ($name === '') {
                $fail('name', 'Le nom ne peut pas être vide.');
            } elseif (mb_strlen($name) > self::NAME_MAX) {
                $fail('name', sprintf('Le nom dépasse %d caractères.', self::NAME_MAX));
            } else {
                $fields['name'] = $name;
            }
        }

        $category    = array_key_exists('category', $input) ? self::nullableCode($input['category']) : ($current['category_code'] ?? null);
        $subcategory = array_key_exists('subcategory', $input) ? self::nullableCode($input['subcategory']) : ($current['subcategory_code'] ?? null);
        // Changer de catégorie sans redonner la sous-catégorie : l'ancienne n'a plus de sens.
        if (array_key_exists('category', $input) && !array_key_exists('subcategory', $input) && $subcategory !== null
            && $this->media->categoryParent($subcategory) !== $category) {
            $subcategory = null;
        }

        if ($category === false) {
            $fail('category', 'Code de catégorie invalide.');
        } elseif ($category !== null && $this->media->categoryParent($category) !== null) {
            $fail('category', 'Catégorie inconnue (ou c\'est une sous-catégorie) : ' . $category . '.');
        }
        if ($subcategory === false) {
            $fail('subcategory', 'Code de sous-catégorie invalide.');
        } elseif ($subcategory !== null) {
            $parent = $this->media->categoryParent($subcategory);
            if (!is_string($parent)) {
                $fail('subcategory', 'Sous-catégorie inconnue : ' . $subcategory . '.');
            } elseif ($category === null || $parent !== $category) {
                $fail('subcategory', 'La sous-catégorie « ' . $subcategory . ' » n\'appartient pas à la catégorie donnée.');
            }
        }
        if (array_key_exists('category', $input) || array_key_exists('subcategory', $input)) {
            $fields['category_code']    = is_string($category) ? $category : null;
            $fields['subcategory_code'] = is_string($subcategory) ? $subcategory : null;
        }

        if (array_key_exists('season', $input)) {
            $season = self::nullableCode($input['season']);
            if ($season === false || (is_string($season) && !$this->media->seasonExists($season))) {
                $fail('season', 'Saison inconnue.');
            } else {
                $fields['season_code'] = $season;
            }
        }

        foreach (['offerItemId' => ['offer_item_id', 'offerItemExists', 'Produit du catalogue inconnu.'],
                  'shopId'      => ['shop_id', 'shopExists', 'Boutique inconnue.']] as $key => [$column, $check, $message]) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $value = $input[$key];
            if ($value === null || $value === '') {
                $fields[$column] = null;
            } elseif (filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false
                || !$this->media->{$check}((int) $value)) {
                $fail($key, $message);
            } else {
                $fields[$column] = (int) $value;
            }
        }

        if (array_key_exists('cutout', $input)) {
            $cutout = filter_var($input['cutout'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($cutout === null) {
                $fail('cutout', 'Valeur attendue : true ou false.');
            } else {
                $fields['cutout'] = $cutout ? 1 : 0;
            }
        }

        return ['fields' => $fields, 'errors' => $errors];
    }

    /** @param array<string,mixed> $fields */
    public function update(int $id, array $fields): array
    {
        $this->media->update($id, $fields);

        return $this->serialize((array) $this->media->find($id));
    }

    /** La couverture d'un fichier (celle d'une vidéo, tirée par le navigateur). */
    public function replaceThumbnail(int $id, string $image): array
    {
        $row = (array) $this->media->find($id);
        $path = MediaStore::writeThumbnail((string) $row['file_path'], $image);
        if ($path === null) {
            throw new \RuntimeException('Image illisible : la couverture n\'a pas pu être réduite.');
        }
        $this->media->update($id, ['thumb_path' => $path]);

        return $this->serialize((array) $this->media->find($id));
    }

    public function setArchived(int $id, bool $archived): array
    {
        $this->media->setArchived($id, $archived);

        return $this->serialize((array) $this->media->find($id));
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        return $this->media->find($id);
    }

    /**
     * @param array<string,mixed> $filters
     * @return array{items:list<array<string,mixed>>, total:int}
     */
    public function page(array $filters, string $sort, bool $descending, int $page, int $perPage): array
    {
        $result = $this->media->page($filters, $sort, $descending, $page, $perPage);

        return ['items' => array_map(fn (array $row): array => $this->serialize($row), $result['rows']), 'total' => $result['total']];
    }

    /** Catégories (avec leurs sous-catégories) et saisons, pour les filtres et la fiche. */
    public function references(): array
    {
        $heads = [];
        $subs  = [];
        foreach ($this->media->categories() as $row) {
            $entry = ['code' => (string) $row['code'], 'label' => (string) $row['label'], 'files' => (int) $row['files']];
            if ($row['parent_code'] === null) {
                $heads[(string) $row['code']] = $entry + ['subcategories' => []];
            } else {
                $subs[] = [(string) $row['parent_code'], $entry];
            }
        }
        foreach ($subs as [$parent, $entry]) {
            if (isset($heads[$parent])) {
                $heads[$parent]['subcategories'][] = $entry;
            }
        }

        return [
            'categories' => array_values($heads),
            'seasons'    => array_map(static fn (array $row): array => ['code' => (string) $row['code'], 'label' => (string) $row['label']], $this->media->seasons()),
            'counts'     => $this->media->counts(),
            'limits'     => [
                'imageMaxBytes' => MediaStore::IMAGE_MAX_BYTES,
                'videoMaxBytes' => MediaStore::VIDEO_MAX_BYTES,
                'imageTypes'    => ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'],
                'videoTypes'    => ['video/mp4', 'video/quicktime', 'video/webm'],
                // Ce que PHP accepte en corps de requête sur ce serveur (`post_max_size`) :
                // au-delà, le fichier n'arrive pas du tout. Nul si PHP ne pose pas de limite.
                'serverMaxBytes' => MediaStore::iniBytes((string) ini_get('post_max_size')),
            ],
        ];
    }

    /**
     * La fiche telle que l'API la rend : camelCase, dates ISO 8601 UTC, URL absolues.
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public function serialize(array $row): array
    {
        $pair = static fn (?string $code, ?string $label): ?array => $code !== null ? ['code' => $code, 'label' => (string) $label] : null;

        return [
            'id'           => (string) $row['id'],
            'kind'         => (string) $row['kind'],
            'name'         => (string) $row['name'],
            'url'          => self::publicUrl((string) $row['file_path']),
            'thumbnailUrl' => $row['thumb_path'] !== null ? self::publicUrl((string) $row['thumb_path']) : null,
            // Ce qu'un post ou un écran envoie : 2 048 px au plus ; l'original quand il est déjà assez léger.
            'webUrl'       => self::publicUrl((string) ($row['web_path'] ?? $row['file_path'])),
            'path'         => (string) $row['file_path'],
            'mimeType'     => (string) $row['mime'],
            'bytes'        => (int) $row['bytes'],
            'width'        => $row['width'] !== null ? (int) $row['width'] : null,
            'height'       => $row['height'] !== null ? (int) $row['height'] : null,
            'category'     => $pair($row['category_code'] ?? null, $row['category_label'] ?? null),
            'subcategory'  => $pair($row['subcategory_code'] ?? null, $row['subcategory_label'] ?? null),
            'season'       => $pair($row['season_code'] ?? null, $row['season_label'] ?? null),
            'offerItem'    => $row['offer_item_id'] !== null ? ['id' => (string) $row['offer_item_id'], 'name' => (string) ($row['offer_item_name'] ?? '')] : null,
            'shop'         => $row['shop_id'] !== null ? ['id' => (string) $row['shop_id'], 'name' => (string) ($row['shop_name'] ?? '')] : null,
            'cutout'       => (int) $row['cutout'] === 1,
            'source'       => (string) $row['source'],
            'archived'     => $row['archived_at'] !== null,
            'createdAt'    => self::iso($row['created_at']),
            'updatedAt'    => self::iso($row['updated_at']),
        ];
    }

    /**
     * L'adresse absolue d'un fichier.
     *
     * `MAR_PUBLIC_BASE_URL` (l'adresse publique du module, sans le `/api`) si elle est
     * posée ; sinon l'adresse par laquelle la requête est arrivée — l'hôte, et le
     * répertoire d'installation lu devant `/api/v1/`. Sans l'une ni l'autre (ligne de
     * commande), le chemin reste relatif à la racine du module.
     */
    public static function publicUrl(string $path): string
    {
        $base = rtrim(trim((string) Config::get('MAR_PUBLIC_BASE_URL', '')), '/');
        if ($base === '') {
            $host = (string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
            $host = trim(explode(',', $host)[0]);
            if ($host === '' || preg_match('/^[A-Za-z0-9.-]+(:\d+)?$/', $host) !== 1) {
                return $path;
            }
            $uri  = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
            $at   = strpos($uri, '/api/v1/');
            $root = $at !== false ? preg_replace('#/api$#', '', substr($uri, 0, $at)) : '';
            $base = (Session::isHttps($_SERVER) ? 'https://' : 'http://') . $host . rtrim((string) $root, '/');
        }

        return $base . '/' . implode('/', array_map('rawurlencode', explode('/', ltrim($path, '/'))));
    }

    /** Une date de la base (heure du serveur) en ISO 8601 UTC. */
    private static function iso(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        $date = new DateTimeImmutable($value);

        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    /** Un code de référence : `null` (vide), le code, ou `false` s'il est mal formé. */
    private static function nullableCode(mixed $value): string|false|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_string($value) && preg_match('/^[a-z0-9-]{1,40}$/', $value) === 1 ? $value : false;
    }
}
