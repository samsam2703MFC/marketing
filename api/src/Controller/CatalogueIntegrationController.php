<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\CatalogueService;
use Marketing\Support\Config;
use Marketing\Support\Envelope;
use Marketing\Support\Keys;
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
 * vendus par la boutique seulement, prix de la boutique, couverture et dernière page de la charte,
 * trois mises en page, source gamme ou choix.
 *
 * Et une route publique : la page d'impression d'un catalogue, par un lien signé de 48 h
 * (`…/catalogue-prints/{token}`), que le dashboard ouvre pour produire le PDF.
 */
final class CatalogueIntegrationController
{
    private const FILTERS = ['status' => CatalogueService::STATUSES];

    public function __construct(private readonly CatalogueService $service = new CatalogueService())
    {
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

            return Envelope::ok($data + ['layouts' => array_keys(CatalogueService::LAYOUTS)]);
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

            return Envelope::ok($result['items'], ['pagination' => Envelope::pagination($query['page'], $query['perPage'], $result['total'])]);
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
        return $this->withCatalogue($request, fn (array $row): array => Envelope::ok($this->service->serialize($row)));
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
        return $this->withCatalogue($request, function (array $row) use ($request): array {
            $lang = $request->body['lang'] ?? 'fr';
            $unknown = array_diff(array_keys($request->body), ['lang']);
            if ($unknown !== [] || !in_array($lang, CatalogueService::LANGS, true)) {
                return Envelope::error('VALIDATION_FAILED', 'Corps invalide.', 422, [['field' => $unknown !== [] ? (string) reset($unknown) : 'lang', 'message' => $unknown !== [] ? 'Champ inconnu.' : 'fr ou nl.']]);
            }
            $token = $this->service->printToken((int) $row['id'], $lang);
            if ($token === null) {
                return Envelope::error('DEPENDENCY_UNAVAILABLE', 'MAR_SESSION_SECRET n’est pas renseigné : le lien d’impression ne peut pas être signé.', 503);
            }

            return Envelope::ok(['url' => self::printPage($token['token']), 'token' => $token['token'], 'expiresAt' => $token['expiresAt']], [], 201);
        });
    }

    /** `GET /api/v1/public/marketing/catalogue-prints/{token}` : le document d'un lien d'impression valable. */
    public function printDocument(Request $request): array
    {
        $read = $this->service->readPrintToken((string) $request->param('token'));
        $row = $read !== null ? $this->service->find($read['id']) : null;
        if ($row === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Lien d’impression inconnu ou expiré.', 404);
        }

        return CatalogueController::guard(fn (): array => Envelope::ok($this->service->document($row, null, $read['lang'])));
    }

    // ---------------------------------------------------------------------------------------------

    /** L'adresse de la page d'impression : `{adresse publique du module}/catalogue/?t=…`. */
    private static function printPage(string $token): string
    {
        $base = rtrim((string) (Config::get('MAR_PUBLIC_BASE_URL') ?? ''), '/');
        if ($base === '') {
            $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
            $base = $host !== '' ? ((($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off') ? 'https://' : 'http://') . $host . '/marketing' : '/marketing';
        }

        return $base . '/catalogue/?t=' . rawurlencode($token);
    }

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
