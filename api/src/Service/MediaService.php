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
 * - Les étiquettes (17/11/2026) : moment, usage, produit du webshop, libres ; plus la
 *   saison et la boutique (colonnes), la fin de validité et le format, lu dans la
 *   taille. Une famille se remplace d'un bloc ; la choisir à la main clôt ses
 *   propositions en attente.
 * - Une proposition n'est jamais une étiquette : elle attend un ✓ (appliquée) ou
 *   un ✕ (refusée, elle ne revient plus). Elle dit d'après quoi elle est faite.
 */
final class MediaService
{
    public const NAME_MAX = 200;

    /** Les moments de la régie d'affichage (`signage` : matin, midi, aprem) ; aucun = toute la journée. */
    public const MOMENTS = ['matin' => 'Matin', 'midi' => 'Midi', 'apres-midi' => 'Après-midi'];

    /** Où l'image sert. */
    public const USAGES = ['ecrans' => 'Écrans', 'reseaux' => 'Réseaux', 'catalogue' => 'Catalogue', 'webshop' => 'Webshop', 'affiche' => 'Affiche · bâche'];

    /** Ce qu'une proposition peut porter. */
    public const PROPOSAL_FAMILIES = ['produit', 'moment', 'saison', 'usage', 'detouree'];

    public const PROPOSAL_STATUSES = ['proposed', 'accepted', 'refused'];

    /** Les champs d'étiquettes d'une fiche (modification seulement). */
    public const TAG_FIELDS = ['moments', 'usages', 'products', 'freeTags', 'validUntil'];

    private const PRODUCTS_MAX = 8;
    private const FREE_MAX     = 12;
    public const PROPOSALS_MAX = 500;

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
     * @return array{fields:array<string,mixed>, tags:array<string,array<string,?string>>, errors:list<array{field:string, message:string}>}
     */
    public function validateFields(array $input, array $current = []): array
    {
        $fields = [];
        $tags   = [];
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

        // Les étiquettes : chaque famille reçue remplace la précédente ; une liste vide l'efface.
        foreach (['moments' => ['moment', self::MOMENTS], 'usages' => ['usage', self::USAGES]] as $key => [$family, $allowed]) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            if (!is_array($input[$key]) || !array_is_list($input[$key])) {
                $fail($key, 'Liste attendue.');
                continue;
            }
            $tags[$family] = [];
            foreach ($input[$key] as $i => $value) {
                if (!is_string($value) || !isset($allowed[$value])) {
                    $fail($key . '[' . $i . ']', 'Valeur acceptée : ' . implode(', ', array_keys($allowed)) . '.');
                } else {
                    $tags[$family][$value] = null;
                }
            }
        }

        if (array_key_exists('products', $input)) {
            $list = $input['products'];
            if (!is_array($list) || !array_is_list($list) || count($list) > self::PRODUCTS_MAX) {
                $fail('products', sprintf('Liste de %d produits au plus attendue : [{id, name}].', self::PRODUCTS_MAX));
            } else {
                $tags['produit'] = [];
                foreach ($list as $i => $product) {
                    $id   = is_array($product) ? self::productId($product['id'] ?? null) : null;
                    $name = is_array($product) && is_string($product['name'] ?? null) ? trim($product['name']) : '';
                    if ($id === null) {
                        $fail('products[' . $i . '].id', 'Identifiant du produit du webshop attendu (entier positif).');
                    } elseif ($name === '' || mb_strlen($name) > self::NAME_MAX) {
                        $fail('products[' . $i . '].name', 'Le nom du produit, tel que le webshop le donne, est attendu (200 caractères au plus).');
                    } else {
                        $tags['produit'][$id] = $name;
                    }
                }
            }
        }

        if (array_key_exists('freeTags', $input)) {
            $list = $input['freeTags'];
            if (!is_array($list) || !array_is_list($list) || count($list) > self::FREE_MAX) {
                $fail('freeTags', sprintf('Liste de %d étiquettes au plus attendue.', self::FREE_MAX));
            } else {
                $tags['libre'] = [];
                foreach ($list as $i => $value) {
                    $tag = is_string($value) ? self::freeTag($value) : null;
                    if ($tag === null) {
                        $fail('freeTags[' . $i . ']', 'Une étiquette libre : 1 à 40 lettres, chiffres, espaces ou traits d\'union.');
                    } else {
                        $tags['libre'][$tag] = null;
                    }
                }
            }
        }

        if (array_key_exists('validUntil', $input)) {
            $value = $input['validUntil'];
            if ($value === null || $value === '') {
                $fields['valid_until'] = null;
            } else {
                $date = is_string($value) ? DateTimeImmutable::createFromFormat('!Y-m-d', $value) : false;
                if ($date === false || $date->format('Y-m-d') !== $value) {
                    $fail('validUntil', 'Date attendue : AAAA-MM-JJ.');
                } else {
                    $fields['valid_until'] = $value;
                }
            }
        }

        return ['fields' => $fields, 'tags' => $tags, 'errors' => $errors];
    }

    /**
     * @param array<string,mixed>                $fields Colonnes de `mar_media`.
     * @param array<string,array<string,?string>> $tags  Famille → valeur → libellé (remplace la famille).
     */
    public function update(int $id, array $fields, array $tags = [], int $userId = 0): array
    {
        $this->media->update($id, $fields);
        foreach ($tags as $family => $values) {
            $this->media->replaceTags($id, $family, $values, $userId);
            $this->media->closeProposals($id, $family, array_map('strval', array_keys($values)), $userId);
        }
        // La saison ou le détourage choisis à la main tranchent leurs propositions.
        if (array_key_exists('season_code', $fields)) {
            $this->media->closeProposals($id, 'saison', $fields['season_code'] !== null ? [(string) $fields['season_code']] : [], $userId);
        }
        if (array_key_exists('cutout', $fields)) {
            $this->media->closeProposals($id, 'detouree', (int) $fields['cutout'] === 1 ? ['1'] : [], $userId);
        }

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

        return ['items' => array_map(fn (array $row): array => $this->serialize($row), $this->withTags($result['rows'])), 'total' => $result['total']];
    }

    // --- Propositions d'étiquettes -------------------------------------------------

    /**
     * Les fichiers qui attendent une décision, avec leurs propositions.
     *
     * @return array{items:list<array{media:array<string,mixed>, proposals:list<array<string,mixed>>}>, total:int, proposals:int}
     */
    public function proposalPage(int $page, int $perPage, ?int $mediaId = null): array
    {
        $result = $this->media->proposalMediaPage($page, $perPage, $mediaId);
        $rows   = $this->withTags($result['rows']);
        $byId   = $this->media->proposalsFor(array_map(static fn (array $r): int => (int) $r['id'], $rows));

        return [
            'items' => array_map(fn (array $row): array => [
                'media'     => $this->serialize($row),
                'proposals' => array_map([$this, 'serializeProposal'], $byId[(int) $row['id']] ?? []),
            ], $rows),
            'total'     => $result['total'],
            'proposals' => $this->media->pendingTotal(),
        ];
    }

    /**
     * Lit des propositions : tout ou rien, champ par champ.
     *
     * @return array{rows:list<array{mediaId:int, family:string, value:string, label:?string, reason:string}>, errors:list<array{field:string, message:string}>}
     */
    public function validateProposals(mixed $items): array
    {
        $rows = [];
        $errors = [];
        if (!is_array($items) || !array_is_list($items) || $items === [] || count($items) > self::PROPOSALS_MAX) {
            return ['rows' => [], 'errors' => [['field' => 'items', 'message' => sprintf('Liste de 1 à %d propositions attendue.', self::PROPOSALS_MAX)]]];
        }
        $seasons = array_column($this->media->seasons(), 'label', 'code');
        $known   = [];
        foreach ($items as $i => $item) {
            $at = 'items[' . $i . ']';
            if (!is_array($item)) {
                $errors[] = ['field' => $at, 'message' => 'Objet attendu : {mediaId, family, value, label?, reason}.'];
                continue;
            }
            foreach (array_keys($item) as $key) {
                if (!in_array($key, ['mediaId', 'family', 'value', 'label', 'reason'], true)) {
                    $errors[] = ['field' => $at . '.' . $key, 'message' => 'Champ inconnu.'];
                }
            }
            $mediaId = filter_var($item['mediaId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($mediaId !== false && !array_key_exists($mediaId, $known)) {
                $row = $this->media->find($mediaId);
                $known[$mediaId] = $row !== null && $row['archived_at'] === null;
            }
            if ($mediaId === false || !$known[$mediaId]) {
                $errors[] = ['field' => $at . '.mediaId', 'message' => 'Fichier introuvable dans la médiathèque.'];
            }
            $family = is_string($item['family'] ?? null) ? $item['family'] : '';
            $value  = $item['value'] ?? null;
            $value  = is_int($value) || is_bool($value) ? (string) (int) $value : (is_string($value) ? trim($value) : '');
            $label  = null;
            switch ($family) {
                case 'moment':
                case 'usage':
                    $allowed = $family === 'moment' ? self::MOMENTS : self::USAGES;
                    if (!isset($allowed[$value])) {
                        $errors[] = ['field' => $at . '.value', 'message' => 'Valeur acceptée : ' . implode(', ', array_keys($allowed)) . '.'];
                    }
                    $label = $allowed[$value] ?? null;
                    break;
                case 'produit':
                    $label = is_string($item['label'] ?? null) ? trim($item['label']) : '';
                    if (self::productId($value) === null) {
                        $errors[] = ['field' => $at . '.value', 'message' => 'Identifiant du produit du webshop attendu (entier positif).'];
                    }
                    if ($label === '' || mb_strlen($label) > self::NAME_MAX) {
                        $errors[] = ['field' => $at . '.label', 'message' => 'Le nom du produit, tel que le webshop le donne, est attendu.'];
                    }
                    break;
                case 'saison':
                    if (!isset($seasons[$value])) {
                        $errors[] = ['field' => $at . '.value', 'message' => 'Saison inconnue.'];
                    }
                    $label = isset($seasons[$value]) ? (string) $seasons[$value] : null;
                    break;
                case 'detouree':
                    if ($value !== '1') {
                        $errors[] = ['field' => $at . '.value', 'message' => 'Valeur acceptée : 1 (photo détourée).'];
                    }
                    $label = 'Détourée';
                    break;
                default:
                    $errors[] = ['field' => $at . '.family', 'message' => 'Famille acceptée : ' . implode(', ', self::PROPOSAL_FAMILIES) . '.'];
            }
            $reason = is_string($item['reason'] ?? null) ? trim($item['reason']) : '';
            if ($reason === '' || mb_strlen($reason) > 200) {
                $errors[] = ['field' => $at . '.reason', 'message' => 'D\'après quoi la proposition est faite (1 à 200 caractères).'];
            }
            $rows[] = ['mediaId' => (int) $mediaId, 'family' => $family, 'value' => $value, 'label' => $label, 'reason' => $reason];
        }

        return ['rows' => $errors === [] ? $rows : [], 'errors' => $errors];
    }

    /**
     * Enregistre des propositions déjà lues. Rien ne revient : ce qui est déjà appliqué (la famille
     * choisie pour un moment, un produit, une saison ; la même valeur d'usage ; le détourage) et ce qui
     * a déjà été proposé — en attente, accepté ou refusé — est passé.
     *
     * @param list<array{mediaId:int, family:string, value:string, label:?string, reason:string}> $rows
     * @return array{created:int, skipped:int, proposals:int}
     */
    public function propose(array $rows, int $userId): array
    {
        $created = 0;
        $skipped = 0;
        foreach ($rows as $p) {
            $media = (array) $this->media->find($p['mediaId']);
            $applied = match ($p['family']) {
                'moment', 'produit' => $this->media->hasTag($p['mediaId'], $p['family']),
                'usage'             => $this->media->hasTag($p['mediaId'], 'usage', $p['value']),
                'saison'            => ($media['season_code'] ?? null) !== null,
                'detouree'          => (int) ($media['cutout'] ?? 0) === 1,
                default             => true,
            };
            if (!$applied && $this->media->insertProposal($p['mediaId'], $p['family'], $p['value'], $p['label'], $p['reason'], $userId)) {
                $created++;
            } else {
                $skipped++;
            }
        }

        return ['created' => $created, 'skipped' => $skipped, 'proposals' => $this->media->pendingTotal()];
    }

    public function proposalCount(): int
    {
        return $this->media->pendingTotal();
    }

    /** @return array<string,mixed>|null */
    public function findProposal(int $id): ?array
    {
        return $this->media->findProposal($id);
    }

    /**
     * Tranche une proposition en attente : `accepted` l'applique à la fiche, `refused` la garde
     * pour qu'elle ne revienne pas. Sans effet si elle était déjà tranchée.
     *
     * @param array<string,mixed> $proposal
     */
    public function decide(array $proposal, string $status, int $userId): bool
    {
        $id = (int) $proposal['id'];
        if (!$this->media->decideProposal($id, $status, $userId)) {
            return false;
        }
        if ($status === 'accepted') {
            $mediaId = (int) $proposal['media_id'];
            $value   = (string) $proposal['value'];
            switch ((string) $proposal['family']) {
                case 'moment':
                case 'usage':
                    $this->media->addTag($mediaId, (string) $proposal['family'], $value, null, $userId);
                    break;
                case 'produit':
                    $this->media->addTag($mediaId, 'produit', $value, $proposal['label'] !== null ? (string) $proposal['label'] : null, $userId);
                    break;
                case 'saison':
                    $this->media->update($mediaId, ['season_code' => $value]);
                    $this->media->closeProposals($mediaId, 'saison', [$value], $userId);
                    break;
                case 'detouree':
                    $this->media->update($mediaId, ['cutout' => 1]);
                    break;
            }
        }

        return true;
    }

    /** @param array<string,mixed> $row */
    public function serializeProposal(array $row): array
    {
        return [
            'id'        => (string) $row['id'],
            'mediaId'   => (string) $row['media_id'],
            'family'    => (string) $row['family'],
            'value'     => (string) $row['value'],
            'label'     => (string) ($row['label'] ?? $row['value']),
            'reason'    => (string) $row['reason'],
            'status'    => (string) $row['status'],
            'createdAt' => self::iso($row['created_at'] ?? null),
            'decidedAt' => self::iso($row['decided_at'] ?? null),
        ];
    }

    /**
     * Ajoute aux lignes leurs étiquettes et leurs propositions en attente (deux requêtes pour la page).
     *
     * @param list<array<string,mixed>> $rows
     * @return list<array<string,mixed>>
     */
    private function withTags(array $rows): array
    {
        $ids     = array_map(static fn (array $r): int => (int) $r['id'], $rows);
        $tags    = $this->media->tagsFor($ids);
        $pending = $this->media->pendingCounts($ids);

        return array_map(static fn (array $r): array => $r + ['__tags' => $tags[(int) $r['id']] ?? [], '__pending' => $pending[(int) $r['id']] ?? 0], $rows);
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
    public function serialize(array $row, bool $withTags = true): array
    {
        $pair = static fn (?string $code, ?string $label): ?array => $code !== null ? ['code' => $code, 'label' => (string) $label] : null;
        $id   = (int) $row['id'];
        $tags = $withTags ? ($row['__tags'] ?? $this->media->tagsFor([$id])[$id] ?? []) : [];
        $of   = static fn (string $family): array => array_values(array_filter($tags, static fn (array $t): bool => $t['family'] === $family));
        $width  = $row['width'] !== null ? (int) $row['width'] : null;
        $height = $row['height'] !== null ? (int) $row['height'] : null;

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
            'width'        => $width,
            'height'       => $height,
            // Lu dans la taille, jamais stocké : carré à 5 % près.
            'format'       => self::format($width, $height),
            'category'     => $pair($row['category_code'] ?? null, $row['category_label'] ?? null),
            'subcategory'  => $pair($row['subcategory_code'] ?? null, $row['subcategory_label'] ?? null),
            'season'       => $pair($row['season_code'] ?? null, $row['season_label'] ?? null),
            'offerItem'    => $row['offer_item_id'] !== null ? ['id' => (string) $row['offer_item_id'], 'name' => (string) ($row['offer_item_name'] ?? '')] : null,
            'shop'         => $row['shop_id'] !== null ? ['id' => (string) $row['shop_id'], 'name' => (string) ($row['shop_name'] ?? '')] : null,
            'cutout'       => (int) $row['cutout'] === 1,
            'tags'         => [
                'moments'  => array_column($of('moment'), 'value'),
                'usages'   => array_column($of('usage'), 'value'),
                'products' => array_map(static fn (array $t): array => ['id' => $t['value'], 'name' => (string) $t['label']], $of('produit')),
                'free'     => array_column($of('libre'), 'value'),
            ],
            'validUntil'   => isset($row['valid_until']) && $row['valid_until'] !== null ? substr((string) $row['valid_until'], 0, 10) : null,
            'pendingProposals' => $withTags ? (int) ($row['__pending'] ?? $this->media->pendingCounts([$id])[$id] ?? 0) : 0,
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

    /** Carré (à 5 % près), portrait ou paysage ; nul sans taille connue. */
    public static function format(?int $width, ?int $height): ?string
    {
        if (!$width || !$height) {
            return null;
        }
        $ratio = $width / $height;

        return $ratio >= 0.95 && $ratio <= 1.05 ? 'carre' : ($ratio > 1 ? 'paysage' : 'portrait');
    }

    /** L'identifiant d'un produit du webshop (celui de l'ERP), en texte ; nul s'il est mal formé. */
    private static function productId(mixed $value): ?string
    {
        $text = is_int($value) ? (string) $value : (is_string($value) ? trim($value) : '');

        return preg_match('/^[1-9][0-9]{0,18}$/', $text) === 1 ? $text : null;
    }

    /** Une étiquette libre : sans « # », en minuscules, espaces resserrés ; nulle si mal formée. */
    private static function freeTag(string $value): ?string
    {
        $tag = mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', ltrim(trim($value), '#'))));

        return preg_match("/^[\\p{L}\\p{N}][\\p{L}\\p{N} '’&-]{0,39}$/u", $tag) === 1 ? $tag : null;
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
