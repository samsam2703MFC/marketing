<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\CatalogueOrderFormService;
use Marketing\Service\CatalogueService;
use Marketing\Service\CatalogueShopService;
use Marketing\Service\MediaService;
use Marketing\Support\Envelope;
use Marketing\Support\Keys;
use Marketing\Support\MediaStore;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les catalogues d'une boutique, pour le dashboard magasin du cockpit (portail Pilotage réseau) :
 * `/api/v1/integration/marketing/shops/{shopId}/…`, entre portails (docs/PORTAILS.md).
 *
 * Identité : le jeton de service commun aux portails (`erp_jeton_service` d'erp_cles, en-tête
 * `X-Service-Token`), comparé en temps constant. Absent → 401 `AUTH_TOKEN_MISSING` ; faux →
 * 401 `AUTH_TOKEN_INVALID`. La boutique est celle du chemin (`shopId` = son identifiant de caisse
 * ERP) : c'est le dashboard, qui connaît la session du gérant, qui la désigne. Le module limite
 * ensuite TOUT à elle — un catalogue d'une autre boutique, ou de la marque, répond 404.
 *
 * Contraintes appliquées ici, quoi que le dashboard envoie (voir `CatalogueService`) : produits
 * vendus par la boutique seulement, prix de la boutique, 8 à 16 pages (par 2) dont les quatre de la
 * charte (couverture, page 2, avant-dernière, dernière — aucun champ pour elles), cinq mises en page
 * (dont les présentations de gamme), trois gabarits, photos de la place libre du réseau ou d'elle seule
 * (`…/catalogue-media`), source gamme ou choix.
 *
 * Et une route publique : la page d'impression d'un catalogue, par un lien signé de 48 h
 * (`…/catalogue-prints/{token}`), que le dashboard ouvre pour produire le PDF.
 */
final class CatalogueIntegrationController
{
    private const FILTERS = ['status' => CatalogueService::STATUSES];
    /** Une photo importée par la boutique (un JSON en base64 doit rester sous la taille de requête du serveur). */
    private const UPLOAD_MAX_BYTES = 5_000_000;

    private readonly CatalogueShopService $shops;
    private readonly CatalogueOrderFormService $orderForms;

    public function __construct(private readonly CatalogueService $service = new CatalogueService(), ?CatalogueShopService $shops = null, ?CatalogueOrderFormService $orderForms = null)
    {
        $this->shops = $shops ?? new CatalogueShopService($service);
        $this->orderForms = $orderForms ?? new CatalogueOrderFormService($service);
    }

    /** `GET …/shops/{shopId}/catalogue-products` : ce que la boutique vend au webshop, à ses prix. */
    public function products(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            if ($request->query !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) array_key_first($request->query), 'message' => 'Paramètre inconnu.']]);
            }
            $data = $this->service->webshopProducts([$shop]);
            // Le prix de SA boutique, le seul qu'elle imprime.
            foreach ($data['products'] as &$product) {
                $mine = $product['prices'][0] ?? null;
                $product['priceCents'] = $mine['webPriceCents'] ?? $mine['shopPriceCents'] ?? null;
                $product['shopPriceCents'] = $mine['shopPriceCents'] ?? null;
                unset($product['prices'], $product['priceDiffers']);
            }
            unset($product);

            return Envelope::ok($data + ['layouts' => array_keys(CatalogueService::LAYOUTS), 'templates' => CatalogueService::TEMPLATES, 'headers' => CatalogueService::HEADERS,
                'fillers' => CatalogueService::FILLERS, 'pageCounts' => CatalogueService::PAGE_COUNTS]);
        });
    }

    /**
     * `GET …/shops/{shopId}/catalogue-media?page=&perPage=&filter[name][like]=` : les images de la
     * médiathèque que la boutique peut mettre dans la place libre d'une page (celles du réseau et les
     * siennes), paginées, les plus récentes d'abord.
     */
    public function media(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            $errors = [];
            foreach (array_keys($request->query) as $key) {
                if (!in_array($key, ['page', 'perPage', 'filter'], true)) {
                    $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
                }
            }
            $page = (string) ($request->query['page'] ?? '1');
            $perPage = (string) ($request->query['perPage'] ?? '24');
            if (!ctype_digit($page) || (int) $page < 1) {
                $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
            }
            if (!ctype_digit($perPage) || (int) $perPage < 1 || (int) $perPage > 100) {
                $errors[] = ['field' => 'perPage', 'message' => 'Entre 1 et 100.'];
            }
            $filter = $request->query['filter'] ?? [];
            $name = '';
            if (!is_array($filter) || array_diff(array_keys($filter), ['name']) !== []
                || (isset($filter['name']) && (!is_array($filter['name']) || array_keys($filter['name']) !== ['like'] || !is_string($filter['name']['like'])))) {
                $errors[] = ['field' => 'filter', 'message' => 'Filtre accepté : filter[name][like]=texte.'];
            } else {
                $name = mb_substr(trim((string) ($filter['name']['like'] ?? '')), 0, 80);
            }
            if ($errors !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
            }
            $result = $this->service->catalogueMedia($shop['id'], $name, (int) $page, (int) $perPage);

            return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, (int) $perPage, $result['total'])]);
        });
    }

    /**
     * `POST …/shops/{shopId}/catalogue-media` {name, contentBase64} : une photo que la boutique importe (15/11/2026,
     * demande : « dans le catalogue, je dois pouvoir changer ou importer de la médiathèque une photo ou une illustration
     * pour les bundles ou les promotions »). Elle entre dans la médiathèque, rangée à SA boutique (`shop_id`, source
     * `cockpit`) : la boutique la retrouve dans `catalogue-media`, et elle seule (avec le réseau). Une image seulement
     * (JPEG, PNG, WebP…, pas de vidéo), 5 Mo au plus. Le même fichier déjà déposé n'est pas copié : il est rendu (200).
     */
    public function mediaUpload(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            $body = is_array($request->body) ? $request->body : [];
            $errors = [];
            foreach (array_keys($body) as $key) {
                if (!in_array($key, ['name', 'contentBase64'], true)) {
                    $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
                }
            }
            $name = trim(mb_substr((string) ($body['name'] ?? ''), 0, 120));
            $raw = (string) ($body['contentBase64'] ?? '');
            $binary = $raw !== '' ? base64_decode((string) preg_replace('#^data:[^,]*,#', '', $raw), true) : false;
            if ($binary === false || $binary === '') {
                $errors[] = ['field' => 'contentBase64', 'message' => 'Le fichier, encodé en base64, est attendu.'];
            } elseif (strlen($binary) > self::UPLOAD_MAX_BYTES) {
                $errors[] = ['field' => 'contentBase64', 'message' => 'Image trop lourde : 5 Mo au plus.'];
            }
            if ($errors !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Photo invalide.', 422, $errors);
            }
            try {
                $info = MediaStore::inspect((string) $binary);
            } catch (\RuntimeException $e) {
                return Envelope::error('VALIDATION_FAILED', 'Photo invalide.', 422, [['field' => 'contentBase64', 'message' => $e->getMessage()]]);
            }
            if ($info['kind'] !== 'image') {
                return Envelope::error('VALIDATION_FAILED', 'Photo invalide.', 422, [['field' => 'contentBase64', 'message' => 'Une image est attendue (pas une vidéo).']]);
            }
            $media = new MediaService();
            $result = $media->create((string) $binary, ['name' => $name !== '' ? $name : 'Photo de la boutique', 'shop_id' => (int) $shop['id'], 'source' => 'cockpit'], null, 0);
            $m = $result['media'];
            // Un doublon d'une image d'une AUTRE boutique ne devient pas la sienne : la place libre ne l'accepterait pas.
            $row = $media->find((int) $m['id']);
            if ($row !== null && $row['shop_id'] !== null && (int) $row['shop_id'] !== (int) $shop['id']) {
                return Envelope::error('CONFLICT', 'Cette image est déjà dans la médiathèque d’une autre boutique.', 409);
            }

            return Envelope::ok(['id' => (int) $m['id'], 'name' => $m['name'], 'url' => $m['webUrl'], 'thumbnailUrl' => $m['thumbnailUrl'], 'duplicate' => $result['duplicate']],
                [], $result['duplicate'] ? 200 : 201);
        });
    }

    /** `GET …/shops/{shopId}/catalogues` */
    public function index(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            [$query, $errors] = CatalogueController::listQuery($request->query, self::FILTERS);
            if ($errors !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres de la liste invalides.', 422, $errors);
            }
            $result = $this->service->page($query['filters'], $query['sort'], $query['descending'], $query['page'], $query['perPage'], $shop['id']);
            // Ce que la boutique en a fait (impression) : ajouté à chaque catalogue.
            $items = array_map(fn (array $item): array => $item + ['print' => $this->printOf((int) $item['id'], $shop)], $result['items']);

            return Envelope::ok($items, ['pagination' => Envelope::pagination($query['page'], $query['perPage'], $result['total'])]);
        });
    }

    /** `POST …/shops/{shopId}/catalogues` */
    public function store(Request $request): array
    {
        return $this->withShop($request, fn (array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->service->create($request->body, $shop, null), [], 201)
        ));
    }

    /** `GET …/shops/{shopId}/catalogues/{id}` */
    public function show(Request $request): array
    {
        return $this->withCatalogue($request, fn (array $row, array $shop): array => Envelope::ok($this->shops->serialize($row, $shop)));
    }

    /** `PUT …/shops/{shopId}/catalogues/{id}` */
    public function update(Request $request): array
    {
        return $this->withCatalogue($request, fn (array $row, array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->service->update($row, $request->body, $shop['id'], null))
        ));
    }

    /** `DELETE …/shops/{shopId}/catalogues/{id}` */
    public function destroy(Request $request): array
    {
        return $this->withCatalogue($request, fn (array $row, array $shop): array => $this->service->delete((int) $row['id'], $shop['id'])
            ? Response::data(null, 204)
            : Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue introuvable.', 404));
    }

    /** `GET …/shops/{shopId}/catalogues/{id}/document?lang=` */
    public function document(Request $request): array
    {
        return $this->withCatalogue($request, function (array $row) use ($request): array {
            foreach (array_keys($request->query) as $key) {
                if ($key !== 'lang') {
                    return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) $key, 'message' => 'Paramètre inconnu.']]);
                }
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->service->document($row, null, (string) ($request->query['lang'] ?? 'fr'))));
        });
    }

    /**
     * `POST …/shops/{shopId}/catalogues/{id}/print-links` `{lang}` : un lien signé (48 h) vers la page
     * d'impression du Marketing, qui compose les pages et ouvre « Enregistrer au format PDF ».
     */
    public function printLink(Request $request): array
    {
        return $this->withCatalogue($request, fn (array $row, array $shop): array => $this->printLinkFor($row, $shop, $request));
    }

    /** `POST …/shops/{shopId}/brand-catalogues/{id}/print-links` : la version de la boutique d'un catalogue de la marque. */
    public function brandPrintLink(Request $request): array
    {
        return $this->withReceived($request, fn (array $row, array $shop): array => $this->printLinkFor($row, $shop, $request));
    }

    private function printLinkFor(array $row, array $shop, Request $request): array
    {
        return (function () use ($row, $shop, $request): array {
            $lang = $request->body['lang'] ?? 'fr';
            $unknown = array_diff(array_keys($request->body), ['lang']);
            if ($unknown !== [] || !in_array($lang, CatalogueService::LANGS, true)) {
                return Envelope::error('VALIDATION_FAILED', 'Corps invalide.', 422, [['field' => $unknown !== [] ? (string) reset($unknown) : 'lang', 'message' => $unknown !== [] ? 'Champ inconnu.' : 'fr ou nl.']]);
            }
            $token = $this->service->printToken((int) $row['id'], $lang, null, $row['owner'] === 'marque' ? $shop['id'] : null);
            if ($token === null) {
                return Envelope::error('DEPENDENCY_UNAVAILABLE', 'MAR_SESSION_SECRET n’est pas renseigné : le lien d’impression ne peut pas être signé.', 503);
            }

            return Envelope::ok(['url' => CatalogueService::publicPage('t', $token['token']), 'token' => $token['token'], 'expiresAt' => $token['expiresAt']], [], 201);
        })();
    }

    /** `GET /api/v1/public/marketing/catalogue-prints/{token}` : le document d'un lien d'impression valable. */
    public function printDocument(Request $request): array
    {
        $read = $this->service->readPrintToken((string) $request->param('token'));
        $row = $read !== null ? $this->service->find($read['id']) : null;
        if ($row === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Lien d’impression inconnu ou expiré.', 404);
        }
        if ($read['shop'] !== null) {
            $shop = $this->service->shops([$read['shop']])[0] ?? null;
            if ($shop === null || $row['owner'] !== 'marque') {
                return Envelope::error('RESOURCE_NOT_FOUND', 'Lien d’impression inconnu ou expiré.', 404);
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->shops->document($row, $shop, $read['lang'])));
        }

        return CatalogueController::guard(fn (): array => Envelope::ok($this->service->document($row, null, $read['lang'])));
    }

    // ---------------------------------------------------------------------------------------------
    // L'assistant du franchisé : Vérifier · Imprimer · Diffuser (son catalogue ou celui de la marque reçu)
    // ---------------------------------------------------------------------------------------------

    /** `GET …/catalogues/{id}/checks?lang=` · `GET …/brand-catalogues/{id}/checks?lang=` : les points à voir avant d'imprimer. */
    public function checks(Request $request): array
    {
        return $this->withAny($request, function (array $row, array $shop) use ($request): array {
            $lang = self::langQuery($request);
            if (is_array($lang)) {
                return $lang;
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->shops->checks($row, $shop, $lang)));
        });
    }

    /** `PUT …/catalogues/{id}/checks/{code}` `{seen}` : un point vu (idempotent). */
    public function markSeen(Request $request): array
    {
        return $this->withAny($request, fn (array $row, array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->shops->markSeen($row, $shop, (string) $request->param('code'), $request->body))
        ));
    }

    /** `POST …/catalogues/{id}/prints` `{quantity}` : « Marquer imprimé · N ex. » — la charte publiée est figée. */
    public function prints(Request $request): array
    {
        return $this->withAny($request, fn (array $row, array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->shops->recordPrint($row, $shop, $request->body), [], 201)
        ));
    }

    /** `GET …/catalogues/{id}/public-links` : le lien permanent en cours (liste d'un élément, ou vide). */
    public function links(Request $request): array
    {
        return $this->withAny($request, function (array $row, array $shop) use ($request): array {
            if ($request->query !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) array_key_first($request->query), 'message' => 'Paramètre inconnu.']]);
            }
            $link = $this->shops->currentLink($row, $shop);

            return Envelope::ok($link === null ? [] : [$link], ['pagination' => Envelope::pagination(1, 1, $link === null ? 0 : 1)]);
        });
    }

    /** `POST …/catalogues/{id}/public-links` : un nouveau lien permanent ; le précédent est révoqué (« Nouveau lien »). */
    public function newLink(Request $request): array
    {
        return $this->withAny($request, function (array $row, array $shop) use ($request): array {
            if ($request->body !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Corps invalide.', 422, [['field' => (string) array_key_first($request->body), 'message' => 'Champ inconnu.']]);
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->shops->renewLink($row, $shop), [], 201));
        });
    }

    /** `GET /api/v1/public/marketing/catalogue-links/{token}?lang=` : le catalogue en ligne (lecture seule, dernière version). */
    public function linkDocument(Request $request): array
    {
        $read = $this->shops->readLink((string) $request->param('token'));
        if ($read === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue en ligne introuvable : le lien a été remplacé ou n’existe pas.', 404);
        }
        $lang = self::langQuery($request);
        if (is_array($lang)) {
            return $lang;
        }

        return CatalogueController::guard(fn (): array => Envelope::ok($this->shops->linkDocument($read[0], $read[1], $lang)));
    }

    // ---------------------------------------------------------------------------------------------
    // Le bon de commande (25/11/2026) : les conditions de la boutique, le bon d'un catalogue
    // ---------------------------------------------------------------------------------------------

    /** `GET …/shops/{shopId}/order-conditions` : ses conditions (`configured: false` si elle n'a rien réglé). */
    public function orderConditions(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            if ($request->query !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) array_key_first($request->query), 'message' => 'Paramètre inconnu.']]);
            }

            return Envelope::ok($this->orderForms->conditionsOf($shop['id']));
        });
    }

    /**
     * `PUT …/shops/{shopId}/order-conditions` `{minDelay, depositPct, holidayDeadlines, pickup, delivery, note}` : ses
     * conditions, une fois pour tous ses bons (idempotent ; 422 sans rien écrire au moindre champ illisible).
     */
    public function saveOrderConditions(Request $request): array
    {
        return $this->withShop($request, fn (array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->orderForms->saveConditions($shop['id'], $request->body))
        ));
    }

    /** `GET …/catalogues/{id}/order-form?lang=` · `GET …/brand-catalogues/{id}/order-form?lang=` : le bon de SA version. */
    public function orderForm(Request $request): array
    {
        return $this->withAny($request, function (array $row, array $shop) use ($request): array {
            $lang = self::langQuery($request);
            if (is_array($lang)) {
                return $lang;
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->orderForms->forVersion($row, null, $lang, $this->shops->document($row, $shop, $lang))));
        });
    }

    /**
     * `GET /api/v1/public/marketing/catalogue-prints/{token}/order-form?lang=` : le bon de commande d'un lien d'impression
     * valable (la page publique l'imprime ; `lang` : l'autre langue du même catalogue, pour un bon FR + NL).
     */
    public function printOrderForm(Request $request): array
    {
        $read = $this->service->readPrintToken((string) $request->param('token'));
        $row = $read !== null ? $this->service->find($read['id']) : null;
        if ($row === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Lien d’impression inconnu ou expiré.', 404);
        }
        $lang = self::langQuery($request);
        if (is_array($lang)) {
            return $lang;
        }
        $lang = isset($request->query['lang']) ? $lang : $read['lang'];
        if ($read['shop'] !== null) {
            $shop = $this->service->shops([$read['shop']])[0] ?? null;
            if ($shop === null || $row['owner'] !== 'marque') {
                return Envelope::error('RESOURCE_NOT_FOUND', 'Lien d’impression inconnu ou expiré.', 404);
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->orderForms->forVersion($row, null, $lang, $this->shops->document($row, $shop, $lang))));
        }

        return CatalogueController::guard(fn (): array => Envelope::ok($this->orderForms->forVersion($row, null, $lang)));
    }

    // ---------------------------------------------------------------------------------------------
    // Les catalogues de la marque préparés pour la boutique (maquette B4)
    // ---------------------------------------------------------------------------------------------

    /** `GET …/shops/{shopId}/brand-catalogues?page=&perPage=` : prêts ou imprimés, les nouveaux d'abord. */
    public function brandIndex(Request $request): array
    {
        return $this->withShop($request, function (array $shop) use ($request): array {
            $errors = [];
            foreach (array_keys($request->query) as $key) {
                if (!in_array($key, ['page', 'perPage'], true)) {
                    $errors[] = ['field' => (string) $key, 'message' => 'Paramètre inconnu.'];
                }
            }
            $page = (string) ($request->query['page'] ?? '1');
            $perPage = (string) ($request->query['perPage'] ?? '25');
            if (!ctype_digit($page) || (int) $page < 1) {
                $errors[] = ['field' => 'page', 'message' => 'Entier positif attendu.'];
            }
            if (!ctype_digit($perPage) || (int) $perPage < 1) {
                $errors[] = ['field' => 'perPage', 'message' => 'Entier positif attendu.'];
            }
            if ($errors !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, $errors);
            }
            $per = min(100, (int) $perPage);
            $result = $this->shops->received($shop, (int) $page, $per);

            return Envelope::ok($result['items'], ['pagination' => Envelope::pagination((int) $page, $per, $result['total'])]);
        });
    }

    /** `GET …/brand-catalogues/{id}` */
    public function brandShow(Request $request): array
    {
        return $this->withReceived($request, fn (array $row, array $shop): array => Envelope::ok($this->shops->serialize($row, $shop)));
    }

    /** `GET …/brand-catalogues/{id}/document?lang=` : la version de la boutique (ses produits, ses prix, son QR). */
    public function brandDocument(Request $request): array
    {
        return $this->withReceived($request, function (array $row, array $shop) use ($request): array {
            $lang = self::langQuery($request);
            if (is_array($lang)) {
                return $lang;
            }

            return CatalogueController::guard(fn (): array => Envelope::ok($this->shops->document($row, $shop, $lang)));
        });
    }

    /** `PUT …/brand-catalogues/{id}/reception` `{status: pris|nouveau}` : « Le prendre tel quel » (idempotent). */
    public function reception(Request $request): array
    {
        return $this->withReceived($request, fn (array $row, array $shop): array => CatalogueController::guard(
            fn (): array => Envelope::ok($this->shops->receive($row, $shop, $request->body))
        ));
    }

    /** `POST …/brand-catalogues/{id}/adaptations` : « L'adapter à ma boutique » — 201 la copie, 200 la même ensuite. */
    public function adaptation(Request $request): array
    {
        return $this->withReceived($request, function (array $row, array $shop) use ($request): array {
            if ($request->body !== []) {
                return Envelope::error('VALIDATION_FAILED', 'Corps invalide.', 422, [['field' => (string) array_key_first($request->body), 'message' => 'Champ inconnu.']]);
            }

            return CatalogueController::guard(function () use ($row, $shop): array {
                $out = $this->shops->adapt($row, $shop);

                return Envelope::ok($out['catalogue'], ['removedProducts' => $out['removed']], $out['created'] ? 201 : 200);
            });
        });
    }

    // ---------------------------------------------------------------------------------------------

    /** Le jeton de service : rien ne passe sans lui. */
    private static function denyService(): ?array
    {
        $offered = (string) ($_SERVER['HTTP_X_SERVICE_TOKEN'] ?? '');
        if ($offered === '') {
            return Envelope::error('AUTH_TOKEN_MISSING', 'Jeton de service attendu (en-tête X-Service-Token).', 401);
        }
        $expected = Keys::common('erp_jeton_service') ?? '';
        if (strlen($expected) < 16 || !hash_equals($expected, $offered)) {
            return Envelope::error('AUTH_TOKEN_INVALID', 'Jeton de service refusé.', 401);
        }

        return null;
    }

    /** @param callable(array): array $action */
    private function withShop(Request $request, callable $action): array
    {
        if (($denied = self::denyService()) !== null) {
            return $denied;
        }
        $erp = (string) $request->param('shopId');
        $shop = ctype_digit($erp) ? $this->service->shopByErpId((int) $erp) : null;
        if ($shop === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Boutique inconnue du Marketing.', 404);
        }

        return $action($shop);
    }

    /** Un catalogue de la marque préparé pour la boutique du chemin ; 404 sinon. @param callable(array, array): array $action */
    private function withReceived(Request $request, callable $action): array
    {
        return $this->withShop($request, function (array $shop) use ($request, $action): array {
            $id = $request->intParam('id');
            $row = $id !== null ? $this->shops->findReceived($id, $shop) : null;

            return $row === null ? Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue introuvable.', 404) : $action($row, $shop);
        });
    }

    /** Le sien (`…/catalogues/{id}`) ou celui de la marque reçu (`…/brand-catalogues/{id}`), d'après le chemin. @param callable(array, array): array $action */
    private function withAny(Request $request, callable $action): array
    {
        return str_contains($request->path, '/brand-catalogues/')
            ? $this->withReceived($request, $action)
            : $this->withCatalogue($request, $action);
    }

    /** `?lang=fr|nl` seul ; la langue, ou une réponse 422. @return string|array<string,mixed> */
    private static function langQuery(Request $request): string|array
    {
        foreach (array_keys($request->query) as $key) {
            if ($key !== 'lang') {
                return Envelope::error('VALIDATION_FAILED', 'Paramètres invalides.', 422, [['field' => (string) $key, 'message' => 'Paramètre inconnu.']]);
            }
        }
        $lang = $request->query['lang'] ?? 'fr';
        if (!in_array($lang, CatalogueService::LANGS, true)) {
            return Envelope::error('VALIDATION_FAILED', 'Langue : fr ou nl.', 422, [['field' => 'lang', 'message' => 'fr ou nl.']]);
        }

        return $lang;
    }

    /** L'impression d'un catalogue de la boutique. @return array<string,mixed> */
    private function printOf(int $id, array $shop): array
    {
        $row = $this->service->find($id, $shop['id']);

        return $row === null ? [] : $this->shops->serialize($row, $shop)['print'];
    }

    /** @param callable(array, array): array $action */
    private function withCatalogue(Request $request, callable $action): array
    {
        return $this->withShop($request, function (array $shop) use ($request, $action): array {
            $id = $request->intParam('id');
            // Le périmètre est dans la requête : le catalogue d'une autre boutique n'est pas trouvé.
            $row = $id !== null ? $this->service->find($id, $shop['id']) : null;

            return $row === null ? Envelope::error('RESOURCE_NOT_FOUND', 'Catalogue introuvable.', 404) : $action($row, $shop);
        });
    }
}
