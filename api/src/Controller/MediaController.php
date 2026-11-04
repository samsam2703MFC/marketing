<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\MediaRepository;
use Marketing\Service\MediaService;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\ImageStore;
use Marketing\Support\MediaStore;
use Marketing\Support\Request;
use RuntimeException;

/**
 * La médiathèque commune du marketing (`…/media-assets`, `…/media-library`).
 *
 * Écrite au standard autant que le permet la cohabitation (docs/API_REGISTRY.md,
 * « Médiathèque commune ») : enveloppe `{success, data, meta}`, camelCase,
 * pagination, filtres en liste blanche, codes d'erreur du catalogue §7.2.
 * Contrôleur HTTP seul : lecture et validation des paramètres, enveloppe ; les
 * règles sont dans `MediaService`, le SQL dans `MediaRepository`.
 *
 * Réservée au réseau : la médiathèque appartient au pilotage de la marque. Le
 * module Social y accède par son jeton de service (identité réseau).
 */
final class MediaController
{
    private const PER_PAGE_DEFAULT = 25;
    private const PER_PAGE_MAX     = 100;

    /** Filtres acceptés : champ → opérateurs. */
    private const FILTERS = [
        'kind'        => ['eq'],
        'category'    => ['eq', 'isNull'],
        'subcategory' => ['eq'],
        'season'      => ['eq'],
        'offerItem'   => ['eq'],
        'shop'        => ['eq'],
        'source'      => ['eq'],
        'archived'    => ['eq'],
        'name'        => ['contains'],
    ];

    private const KINDS   = ['image', 'video'];
    private const SOURCES = ['marketing', 'social'];

    /** Champs d'une fiche que l'appelant peut poser (dépôt et modification). */
    private const FIELDS = ['name', 'category', 'subcategory', 'season', 'offerItemId', 'shopId', 'cutout'];

    public function __construct(private readonly MediaService $service = new MediaService())
    {
    }

    /** `GET …/media-library` : catégories, saisons et limites de dépôt. */
    public function library(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return Envelope::ok($this->service->references());
    }

    /** `GET …/media-assets` : une page de la médiathèque. */
    public function index(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['page', 'perPage', 'sort', 'filter'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }

        $page    = self::positiveInt($request->query['page'] ?? '1');
        $perPage = self::positiveInt($request->query['perPage'] ?? (string) self::PER_PAGE_DEFAULT);
        if ($page === null) {
            $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
        }
        if ($perPage === null) {
            $errors[] = ['field' => 'perPage', 'message' => 'Entier positif attendu.'];
        }
        $perPage = min(self::PER_PAGE_MAX, $perPage ?? self::PER_PAGE_DEFAULT);

        $sort       = (string) ($request->query['sort'] ?? '-createdAt');
        $descending = str_starts_with($sort, '-');
        $sortField  = ltrim($sort, '-');
        if (!isset(MediaRepository::SORTS[$sortField])) {
            $errors[] = ['field' => 'sort', 'message' => 'Tri accepté : ' . implode(', ', array_keys(MediaRepository::SORTS)) . ' (préfixe « - » : décroissant).'];
        }

        [$filters, $filterErrors] = self::filters($request->query['filter'] ?? []);
        $errors = array_merge($errors, $filterErrors);

        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres de la liste invalides.', 422, $errors);
        }

        $result = $this->service->page($filters, $sortField, $descending, (int) $page, $perPage);

        return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, $perPage, $result['total'])]);
    }

    /** `GET …/media-assets/{id}`. */
    public function show(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);

        return is_array($row) && isset($row['id']) ? Envelope::ok($this->service->serialize($row)) : $row;
    }

    /**
     * `POST …/media-assets` : dépose un fichier.
     *
     * Deux formes : le fichier en corps brut (`Content-Type` image/…, video/…), les
     * classements en query ; ou du JSON `{content, poster?, name?, category?, …}` avec
     * le fichier en base64. `201` à la création ; `200` et `duplicate: true` quand le
     * même fichier était déjà là (dépôt idempotent).
     */
    public function store(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        $input = $request->raw !== '' ? $request->query : $request->body;
        $allowed = array_merge(self::FIELDS, ['source'], $request->raw !== '' ? [] : ['content', 'poster']);
        $errors = [];
        foreach (array_keys($input) as $key) {
            if (!in_array($key, $allowed, true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }

        $source = (string) ($input['source'] ?? 'marketing');
        if (!in_array($source, self::SOURCES, true)) {
            $errors[] = ['field' => 'source', 'message' => 'Valeur acceptée : ' . implode(', ', self::SOURCES) . '.'];
        }

        $checked = $this->service->validateFields(array_intersect_key($input, array_flip(self::FIELDS)));
        $errors  = array_merge($errors, $checked['errors']);

        try {
            $binary = $request->raw !== '' ? $request->raw : ImageStore::decode((string) ($input['content'] ?? ''));
            $poster = isset($input['poster']) && $input['poster'] !== '' ? ImageStore::decode((string) $input['poster']) : null;
        } catch (RuntimeException $failure) {
            $errors[] = ['field' => 'content', 'message' => $failure->getMessage()];
            $binary = '';
            $poster = null;
        }
        if ($binary === '' && $errors === []) {
            // Un corps vide arrive aussi quand le serveur a coupé un envoi trop gros.
            $errors[] = ['field' => 'content', 'message' => 'Aucun fichier reçu. Si le fichier est volumineux, le serveur a pu refuser l\'envoi.'];
        }
        if ($poster !== null && !self::isImage($poster)) {
            $errors[] = ['field' => 'poster', 'message' => 'La couverture doit être une image (PNG, JPEG, WebP).'];
        }

        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Dépôt refusé.', 422, $errors);
        }

        try {
            $result = $this->service->create($binary, $checked['fields'] + ['source' => $source], $poster, AuthContext::current()?->userId ?? 0);
        } catch (RuntimeException $failure) {
            return Envelope::error('VALIDATION_FAILED', $failure->getMessage(), 422, [['field' => 'content', 'message' => $failure->getMessage()]]);
        }

        return Envelope::ok($result['media'], ['duplicate' => $result['duplicate']], $result['duplicate'] ? 200 : 201);
    }

    /** `PATCH …/media-assets/{id}` : nom, classements, `archived` (retirer ou remettre). */
    public function update(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (!isset($row['id'])) {
            return $row;
        }

        $errors = [];
        foreach (array_keys($request->body) as $key) {
            if (!in_array($key, array_merge(self::FIELDS, ['archived']), true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu ou non modifiable.'];
            }
        }
        $archived = null;
        if (array_key_exists('archived', $request->body)) {
            $archived = is_bool($request->body['archived']) ? $request->body['archived'] : null;
            if ($archived === null) {
                $errors[] = ['field' => 'archived', 'message' => 'Valeur attendue : true ou false.'];
            }
        }
        $checked = $this->service->validateFields(array_intersect_key($request->body, array_flip(self::FIELDS)), $row);
        $errors  = array_merge($errors, $checked['errors']);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Modification refusée.', 422, $errors);
        }

        $media = $this->service->update((int) $row['id'], $checked['fields']);
        if ($archived !== null) {
            $media = $this->service->setArchived((int) $row['id'], $archived);
        }

        return Envelope::ok($media);
    }

    /** `PUT …/media-assets/{id}/thumbnail` : la couverture d'une vidéo (image en corps brut ou `{content}`). */
    public function thumbnail(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (!isset($row['id'])) {
            return $row;
        }

        try {
            $binary = $request->raw !== '' ? $request->raw : ImageStore::decode((string) ($request->body['content'] ?? ''));
        } catch (RuntimeException $failure) {
            return Envelope::error('VALIDATION_FAILED', $failure->getMessage(), 422, [['field' => 'content', 'message' => $failure->getMessage()]]);
        }
        if (!self::isImage($binary)) {
            return Envelope::error('VALIDATION_FAILED', 'La couverture doit être une image (PNG, JPEG, WebP).', 422, [['field' => 'content', 'message' => 'Image attendue.']]);
        }

        try {
            $media = $this->service->replaceThumbnail((int) $row['id'], $binary);
        } catch (RuntimeException $failure) {
            return Envelope::error('VALIDATION_FAILED', $failure->getMessage(), 422, [['field' => 'content', 'message' => $failure->getMessage()]]);
        }

        return Envelope::ok($media);
    }

    /** `DELETE …/media-assets/{id}` : retire le fichier de la médiathèque (idempotent ; le fichier reste servi). */
    public function destroy(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (!isset($row['id'])) {
            return $row;
        }

        return Envelope::ok($this->service->setArchived((int) $row['id'], true));
    }

    /** @return array<string,mixed> La ligne, ou la réponse 404. */
    private function found(Request $request): array
    {
        $id  = $request->intParam('id');
        $row = $id !== null ? $this->service->find($id) : null;

        return $row ?? Envelope::error('RESOURCE_NOT_FOUND', 'Fichier introuvable dans la médiathèque.', 404);
    }

    /** La médiathèque est réservée au réseau ; une identité de boutique reçoit 403. */
    private static function deny(): ?array
    {
        $auth = AuthContext::current();

        return $auth !== null && $auth->isBrandAdmin()
            ? null
            : Envelope::error('PERM_ROLE_REQUIRED', 'La médiathèque est réservée au pilotage réseau.', 403);
    }

    /**
     * @param mixed $raw `filter[champ][op]=valeur` (ou `filter[champ]=valeur`, lu comme `eq`).
     * @return array{0:array<string,mixed>, 1:list<array{field:string, message:string}>}
     */
    private static function filters(mixed $raw): array
    {
        $filters = [];
        $errors  = [];
        if (!is_array($raw)) {
            return [[], [['field' => 'filter', 'message' => 'Forme attendue : filter[champ][opérateur]=valeur.']]];
        }

        foreach ($raw as $field => $spec) {
            $field = (string) $field;
            if (!isset(self::FILTERS[$field])) {
                $errors[] = ['field' => 'filter[' . $field . ']', 'message' => 'Filtre inconnu. Filtres : ' . implode(', ', array_keys(self::FILTERS)) . '.'];
                continue;
            }
            $spec = is_array($spec) ? $spec : [self::FILTERS[$field][0] => $spec];
            foreach ($spec as $op => $value) {
                $op = (string) $op;
                $label = 'filter[' . $field . '][' . $op . ']';
                if (!in_array($op, self::FILTERS[$field], true) || !is_string($value)) {
                    $errors[] = ['field' => $label, 'message' => 'Opérateur accepté : ' . implode(', ', self::FILTERS[$field]) . '.'];
                    continue;
                }
                $ok = true;
                switch ($field . ':' . $op) {
                    case 'kind:eq':
                        $ok = in_array($value, self::KINDS, true);
                        $filters['kind'] = $value;
                        break;
                    case 'source:eq':
                        $ok = in_array($value, self::SOURCES, true);
                        $filters['source'] = $value;
                        break;
                    case 'category:eq':
                    case 'subcategory:eq':
                    case 'season:eq':
                        $ok = preg_match('/^[a-z0-9-]{1,40}$/', $value) === 1;
                        $filters[$field] = $value;
                        break;
                    case 'category:isNull':
                    case 'archived:eq':
                        $flag = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                        $ok = $flag !== null;
                        $filters[$field === 'category' ? 'categoryIsNull' : 'archived'] = (bool) $flag;
                        break;
                    case 'offerItem:eq':
                    case 'shop:eq':
                        $number = self::positiveInt($value);
                        $ok = $number !== null;
                        $filters[$field] = (int) $number;
                        break;
                    case 'name:contains':
                        $ok = mb_strlen($value) <= 100;
                        $filters['name'] = $value;
                        break;
                }
                if (!$ok) {
                    $errors[] = ['field' => $label, 'message' => 'Valeur invalide.'];
                }
            }
        }

        return [$filters, $errors];
    }

    private static function positiveInt(mixed $value): ?int
    {
        $number = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $number === false ? null : (int) $number;
    }

    private static function isImage(string $binary): bool
    {
        try {
            return in_array(MediaStore::sniff($binary), ['png', 'jpg', 'webp'], true);
        } catch (RuntimeException) {
            return false;
        }
    }
}
