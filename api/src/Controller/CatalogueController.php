<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CatalogueRepository;
use Marketing\Service\CatalogueError;
use Marketing\Service\CatalogueOrderFormService;
use Marketing\Service\CatalogueService;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les catalogues produits, côté marque (`…/catalogues`, `…/catalogue-products`,
 * `…/catalogue-charter`).
 *
 * Écrit au standard autant que le permet la cohabitation (docs/API_REGISTRY.md, « Catalogues ») :
 * enveloppe `{success, data, meta}`, camelCase, montants en centimes, pagination, tris et filtres
 * en liste blanche, codes du catalogue §7.2. Contrôleur HTTP seul : les règles sont dans
 * `CatalogueService`, le SQL dans `CatalogueRepository`.
 *
 * Réservé au pilotage de la marque : les boutiques font LEURS catalogues dans le dashboard magasin,
 * qui passe par les routes d'intégration (`CatalogueIntegrationController`).
 */
final class CatalogueController
{
    private const PER_PAGE_DEFAULT = 25;
    private const PER_PAGE_MAX     = 100;

    /** Filtres acceptés : champ → valeurs. */
    private const FILTERS = ['owner' => CatalogueService::OWNERS, 'status' => CatalogueService::STATUSES, 'shop' => null];

    private readonly CatalogueOrderFormService $orderForms;

    public function __construct(private readonly CatalogueService $service = new CatalogueService(), ?CatalogueOrderFormService $orderForms = null)
    {
        $this->orderForms = $orderForms ?? new CatalogueOrderFormService($service);
    }

    /** `GET …/catalogues` */
    public function index(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        [$query, $errors] = self::listQuery($request->query, self::FILTERS);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres de la liste invalides.', 422, $errors);
        }
        $result = $this->service->page($query['filters'], $query['sort'], $query['descending'], $query['page'], $query['perPage']);

        return Envelope::ok($result['items'], ['pagination' => Envelope::pagination($query['page'], $query['perPage'], $result['total'])]);
    }

    /**
     * `POST …/catalogues` — 201. Une création qui reprend une brochure déjà reprise (`fromBrochure`, 21/11/2026) rend le
     * catalogue qui en est déjà fait, en 200 : rejouer l'envoi n'en fait pas un second.
     */
    public function store(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return self::guard(function () use ($request): array {
            $existing = $this->service->existingFromBrochure($request->body);

            return $existing !== null
                ? Envelope::ok($existing)
                : Envelope::ok($this->service->create($request->body, null, self::userId()), [], 201);
        });
    }

    /**
     * `GET …/catalogue-brochures` (21/11/2026, fusion des imprimés, étape 3) : les brochures enregistrées des campagnes (le
     * générateur d'avant), avec le leaflet ou le dépliant qu'on en a repris (`catalogueId`, null : pas encore). Paginée.
     */
    public function brochures(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['page', 'perPage'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $page = (string) ($request->query['page'] ?? '1');
        $perPage = (string) ($request->query['perPage'] ?? (string) self::PER_PAGE_DEFAULT);
        if (!ctype_digit($page) || (int) $page < 1 || !ctype_digit($perPage) || (int) $perPage < 1) {
            $errors[] = ['field' => 'page', 'message' => 'page et perPage : entiers positifs.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
        }
        $per = min(self::PER_PAGE_MAX, (int) $perPage);
        $result = $this->service->brochures((int) $page, $per);

        return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, $per, $result['total'])]);
    }

    /** `GET …/catalogues/{id}` */
    public function show(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);

        return isset($row['id']) && !isset($row['body']) ? Envelope::ok($this->service->serialize($row)) : $row;
    }

    /** `PUT …/catalogues/{id}` */
    public function update(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (isset($row['body'])) {
            return $row;
        }

        return self::guard(fn (): array => Envelope::ok($this->service->update($row, $request->body, null, self::userId())));
    }

    /** `DELETE …/catalogues/{id}` — 204, et 404 au second appel. */
    public function destroy(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $id = $request->intParam('id');

        return $id !== null && $this->service->delete($id)
            ? Response::data(null, 204)
            : Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue introuvable.', 404);
    }

    /** `GET …/catalogues/{id}/document?shopId=&lang=` : la version mise en pages. */
    public function document(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (isset($row['body'])) {
            return $row;
        }
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['shopId', 'lang'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $shop = $request->query['shopId'] ?? null;
        if ($shop !== null && !ctype_digit((string) $shop)) {
            $errors[] = ['field' => 'shopId', 'message' => 'Identifiant de boutique attendu.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
        }

        return self::guard(fn (): array => Envelope::ok($this->service->document($row, $shop !== null ? (int) $shop : null, (string) ($request->query['lang'] ?? 'fr'))));
    }

    /** `GET …/catalogue-products?shopIds=1,2` : le catalogue du webshop, avec les prix de chaque boutique. */
    public function products(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $raw = (string) ($request->query['shopIds'] ?? '');
        $ids = [];
        foreach (array_filter(explode(',', $raw), static fn (string $x): bool => $x !== '') as $part) {
            if (!ctype_digit($part)) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => 'shopIds', 'message' => 'Identifiants séparés par des virgules.']]);
            }
            $ids[] = (int) $part;
        }
        foreach (array_keys($request->query) as $key) {
            if ($key !== 'shopIds') {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) $key, 'message' => 'Paramètre inconnu.']]);
            }
        }

        return Envelope::ok($this->service->webshopProducts($this->service->shops($ids)));
    }

    /** `GET …/catalogue-charter` */
    public function charter(Request $request): array
    {
        unset($request);
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return Envelope::ok($this->service->charter());
    }

    /**
     * `GET …/catalogues/{id}/brand-pages` : les 4 pages de la marque du catalogue — `common`, celles de la charte
     * publiée qu'il lit, et `own`, les siennes (null : il suit la charte).
     */
    public function brandPages(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        if ($request->query !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) array_key_first($request->query), 'message' => 'Paramètre inconnu.']]);
        }
        $row = $this->found($request);
        if (isset($row['body'])) {
            return $row;
        }

        return Envelope::ok($this->service->brandPages($row));
    }

    /**
     * `PUT …/catalogues/{id}/brand-pages` `{cover, page2, penultimate, back}` : les pages de la marque propres à ce
     * catalogue de la marque (chacune : la page entière, ou null pour suivre la charte). Les autres catalogues ne
     * bougent pas.
     */
    public function saveBrandPages(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (isset($row['body'])) {
            return $row;
        }

        return self::guard(fn (): array => Envelope::ok($this->service->saveBrandPages($row, $request->body, self::userId())));
    }

    /** `PUT …/catalogue-charter` */
    public function saveCharter(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return self::guard(fn (): array => Envelope::ok($this->service->saveCharter($request->body, self::userId())));
    }

    /** `PUT …/catalogue-shops/{id}` `{phone2?, webshopUrl?, logoMediaId?}` : ce que la boutique imprime en plus à la dernière page. */
    public function saveShop(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $id = $request->intParam('id');
        if ($id === null || $id < 1) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Boutique inconnue du Marketing.', 404);
        }

        return self::guard(fn (): array => Envelope::ok($this->service->saveShopContact($id, is_array($request->body) ? $request->body : [], self::userId() ?? 0)));
    }

    /** `GET …/catalogue-charter/checks` : « Avant de publier », les boutiques à compléter, les catalogues concernés. */
    public function charterChecks(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        if ($request->query !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) array_key_first($request->query), 'message' => 'Paramètre inconnu.']]);
        }

        return Envelope::ok($this->service->charterChecks());
    }

    /** `GET …/catalogue-charter/publications?page=&perPage=` : les versions publiées, la plus récente d'abord. */
    public function charterVersions(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['page', 'perPage'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $page = (string) ($request->query['page'] ?? '1');
        $perPage = (string) ($request->query['perPage'] ?? '25');
        if (!ctype_digit($page) || (int) $page < 1 || !ctype_digit($perPage) || (int) $perPage < 1) {
            $errors[] = ['field' => 'page', 'message' => 'page et perPage : entiers positifs.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
        }
        $per = min(self::PER_PAGE_MAX, (int) $perPage);
        $result = $this->service->charterVersions((int) $page, $per);

        return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, $per, $result['total'])]);
    }

    /** `POST …/catalogue-charter/publications` `{fromVersion?, note?}` : « Publier pour tous les catalogues ». */
    public function publishCharter(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return self::guard(fn (): array => Envelope::ok($this->service->publishCharter($request->body, self::userId()), [], 201));
    }

    /**
     * `GET …/catalogues/{id}/order-form?lang=&shopId=` (25/11/2026) : le bon de commande d'une version — le contenu exact
     * de son document, et les conditions de la boutique en LECTURE (elle les règle dans son dashboard ; aucune : le cadre
     * vide à remplir).
     */
    public function orderForm(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $row = $this->found($request);
        if (isset($row['body'])) {
            return $row;
        }
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['shopId', 'lang'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $shop = $request->query['shopId'] ?? null;
        if ($shop !== null && !ctype_digit((string) $shop)) {
            $errors[] = ['field' => 'shopId', 'message' => 'Identifiant de boutique attendu.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
        }

        return self::guard(fn (): array => Envelope::ok($this->orderForms->forVersion($row, $shop !== null ? (int) $shop : null, (string) ($request->query['lang'] ?? 'fr'))));
    }

    /**
     * `GET …/catalogue-order-conditions?page=&perPage=` : les conditions du bon de commande que les boutiques ont réglées
     * (lecture seule ; une boutique absente n'a rien réglé).
     */
    public function orderConditions(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['page', 'perPage'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $page = (string) ($request->query['page'] ?? '1');
        $perPage = (string) ($request->query['perPage'] ?? (string) self::PER_PAGE_DEFAULT);
        if (!ctype_digit($page) || (int) $page < 1) {
            $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
        }
        if (!ctype_digit($perPage) || (int) $perPage < 1) {
            $errors[] = ['field' => 'perPage', 'message' => 'Entier positif attendu.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
        }
        $per = min(self::PER_PAGE_MAX, (int) $perPage);
        $result = $this->orderForms->conditionsPage((int) $page, $per);

        return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, $per, $result['total'])]);
    }

    // ---------------------------------------------------------------------------------------------

    /** @return array<string,mixed> La ligne, ou une réponse 404. */
    private function found(Request $request): array
    {
        $id = $request->intParam('id');
        $row = $id !== null ? $this->service->find($id) : null;

        return $row ?? Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue introuvable.', 404);
    }

    /** @param callable(): array $action */
    public static function guard(callable $action): array
    {
        try {
            return $action();
        } catch (CatalogueError $e) {
            return Envelope::error($e->errorCode, $e->getMessage(), $e->status, $e->details);
        }
    }

    private static function deny(): ?array
    {
        $auth = AuthContext::current();

        return $auth !== null && $auth->isBrandAdmin()
            ? null
            : Envelope::error('PERM_ROLE_REQUIRED', 'Les catalogues de la marque sont réservés au pilotage réseau.', 403);
    }

    private static function userId(): ?int
    {
        $id = AuthContext::current()?->userId;

        return $id !== null && $id > 0 ? $id : null;
    }

    /**
     * `page`, `perPage`, `sort`, `filter[champ][eq]`.
     *
     * @param array<string,mixed>              $raw
     * @param array<string, list<string>|null> $filters Valeurs permises ; null = entier positif.
     * @return array{0: array{page:int, perPage:int, sort:string, descending:bool, filters:array<string,mixed>}, 1: list<array{field:string, message:string}>}
     */
    public static function listQuery(array $raw, array $filters): array
    {
        $errors = [];
        foreach (array_keys($raw) as $key) {
            if (!in_array($key, ['page', 'perPage', 'sort', 'filter'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $page = (string) ($raw['page'] ?? '1');
        $perPage = (string) ($raw['perPage'] ?? (string) self::PER_PAGE_DEFAULT);
        if (!ctype_digit($page) || (int) $page < 1) {
            $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
        }
        if (!ctype_digit($perPage) || (int) $perPage < 1) {
            $errors[] = ['field' => 'perPage', 'message' => 'Entier positif attendu.'];
        }
        $sort = (string) ($raw['sort'] ?? '-updatedAt');
        $field = ltrim($sort, '-');
        if (!isset(CatalogueRepository::SORTS[$field])) {
            $errors[] = ['field' => 'sort', 'message' => 'Tri accepté : ' . implode(', ', array_keys(CatalogueRepository::SORTS)) . ' (préfixe « - » : décroissant).'];
        }
        $out = [];
        $filterRaw = $raw['filter'] ?? [];
        if (!is_array($filterRaw)) {
            $errors[] = ['field' => 'filter', 'message' => 'Forme attendue : filter[champ][eq]=valeur.'];
            $filterRaw = [];
        }
        foreach ($filterRaw as $name => $spec) {
            $name = (string) $name;
            $value = is_array($spec) ? ($spec['eq'] ?? null) : $spec;
            if (!array_key_exists($name, $filters) || (is_array($spec) && array_keys($spec) !== ['eq'])) {
                $errors[] = ['field' => 'filter[' . $name . ']', 'message' => 'Filtre inconnu. Filtres : ' . implode(', ', array_keys($filters)) . ' (opérateur eq).'];
                continue;
            }
            $allowed = $filters[$name];
            if ($allowed === null) {
                if (!is_string($value) || !ctype_digit($value)) {
                    $errors[] = ['field' => 'filter[' . $name . ']', 'message' => 'Entier attendu.'];
                    continue;
                }
                $out[$name] = (int) $value;
            } elseif (!is_string($value) || !in_array($value, $allowed, true)) {
                $errors[] = ['field' => 'filter[' . $name . ']', 'message' => 'Valeurs : ' . implode(', ', $allowed) . '.'];
            } else {
                $out[$name] = $value;
            }
        }

        return [[
            'page'       => max(1, (int) $page),
            'perPage'    => min(self::PER_PAGE_MAX, max(1, (int) $perPage)),
            'sort'       => $field,
            'descending' => str_starts_with($sort, '-'),
            'filters'    => $out,
        ], $errors];
    }
}
