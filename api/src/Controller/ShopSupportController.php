<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\ShopSupportRepository;
use Marketing\Service\ShopSupportService;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;

/**
 * `…/shop-supports` : les bâches et les cadres d'affiche des boutiques (Marketing en
 * magasin › Bâches & affiches), que l'assistant de campagne reprend.
 *
 * Écrit au standard (enveloppe, camelCase, pagination, codes du catalogue).
 * Lecture : le réseau, ou une boutique pour les siennes. Écriture : le réseau.
 */
final class ShopSupportController
{
    private const PER_PAGE_MAX = 100;

    public function __construct(
        private readonly ShopSupportRepository $supports = new ShopSupportRepository(),
        private readonly ShopSupportService $service = new ShopSupportService(),
    ) {
    }

    /** `GET …/shop-supports?page=&perPage=&filter[shop][eq]=&filter[kind][eq]=` */
    public function index(Request $request): array
    {
        $auth = AuthContext::current();
        $errors = [];
        foreach (array_keys($request->query) as $key) {
            if (!in_array($key, ['page', 'perPage', 'filter'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
            }
        }
        $page    = filter_var($request->query['page'] ?? '1', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $perPage = filter_var($request->query['perPage'] ?? '100', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($page === false) {
            $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
        }
        if ($perPage === false) {
            $errors[] = ['field' => 'perPage', 'message' => 'Entier positif attendu.'];
        }

        $filters = [];
        $raw = $request->query['filter'] ?? [];
        foreach (is_array($raw) ? $raw : ['' => $raw] as $field => $spec) {
            $value = is_array($spec) ? ($spec['eq'] ?? null) : $spec;
            if (is_array($spec) && array_diff(array_keys($spec), ['eq']) !== []) {
                $errors[] = ['field' => 'filter[' . $field . ']', 'message' => 'Opérateur accepté : eq.'];
            } elseif ($field === 'shop' && is_string($value) && ctype_digit($value)) {
                $filters['shop'] = (int) $value;
            } elseif ($field === 'kind' && in_array($value, ShopSupportService::KINDS, true)) {
                $filters['kind'] = $value;
            } else {
                $errors[] = ['field' => 'filter[' . $field . ']', 'message' => 'Filtres : shop, kind (bache | affiche).'];
            }
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Paramètres de la liste invalides.', 422, $errors);
        }

        $perPage = min(self::PER_PAGE_MAX, (int) $perPage);
        $result  = $this->supports->page($auth, $filters, (int) $page, $perPage);

        return Envelope::ok(
            array_map([$this->service, 'serialize'], $result['rows']),
            ['pagination' => Envelope::pagination((int) $page, $perPage, $result['total'])]
        );
    }

    /** `PUT …/shop-supports/{shopId}` `{ supports: [...] }` : remplace la liste d'une boutique (idempotent). */
    public function replace(Request $request): array
    {
        $auth = AuthContext::current();
        if (!$auth->isBrandAdmin()) {
            return Envelope::error('PERM_ROLE_REQUIRED', 'Les supports des boutiques se déclarent depuis le réseau.', 403);
        }
        $shopId = $request->intParam('shopId');
        if ($shopId === null || !$this->supports->shopVisible($auth, $shopId)) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Boutique introuvable.', 404);
        }
        $unknown = array_diff(array_keys($request->body), ['supports']);
        $checked = $this->service->validate($request->body['supports'] ?? null);
        $errors  = array_merge(array_map(static fn ($k) => ['field' => (string) $k, 'message' => 'Champ inconnu.'], array_values($unknown)), $checked['errors']);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Supports refusés : rien n’a été enregistré.', 422, $errors);
        }

        $this->supports->replace($shopId, $checked['rows'], $auth->userId);
        $result = $this->supports->page($auth, ['shop' => $shopId], 1, self::PER_PAGE_MAX);

        return Envelope::ok(array_map([$this->service, 'serialize'], $result['rows']));
    }
}
