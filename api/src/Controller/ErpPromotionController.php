<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\ErpPromotionRepository;
use Marketing\Service\ErpPromotionService;
use Marketing\Support\AuthContext;
use Marketing\Support\ErpClient;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les promotions de l'ERP, pour les onglets de l'offre (Promotions, Bundles &
 * menus, Bons) : bundles, « X achetés = Y », promotions de quantité, remises
 * programmées et campagnes de bons, lues sur l'API de l'ERP.
 *
 * Route écrite au format du standard autant que le permet la cohabitation
 * (docs/API_REGISTRY.md, §2.4) : enveloppe `{success, data, meta}`, camelCase,
 * montants en centimes, pagination, code d'erreur machine ; le préfixe reste
 * celui du module (`/api/v1/marketing/`), comme toutes ses routes.
 */
final class ErpPromotionController
{
    private const FILTERS = ['family', 'page', 'perPage'];

    public function __construct(private readonly ErpPromotionService $service = new ErpPromotionService())
    {
    }

    public function index(Request $request): array
    {
        $unknown = array_values(array_diff(array_keys($request->query), self::FILTERS));
        if ($unknown !== []) {
            return $this->error('VALIDATION_FAILED', sprintf('Paramètre inconnu : %s.', implode(', ', $unknown)), 422);
        }

        $family = $request->queryString('family');
        if ($family !== null && !array_key_exists($family, ErpPromotionRepository::FAMILIES)) {
            return $this->error('VALIDATION_FAILED', sprintf(
                'family : « %s » inconnue — attendu %s.',
                $family,
                implode(', ', array_keys(ErpPromotionRepository::FAMILIES))
            ), 422);
        }

        $page    = $request->queryInt('page', 1) ?? 1;
        $perPage = $request->queryInt('perPage', 50) ?? 50;
        if ($page < 1 || $perPage < 1) {
            return $this->error('VALIDATION_FAILED', 'page et perPage commencent à 1.', 422);
        }
        // Au-delà de cent, la page est ramenée à cent, comme sur la vitrine.
        $perPage = min(100, $perPage);

        $result = $this->service->list(
            AuthContext::current(),
            $family !== null ? [$family] : array_keys(ErpPromotionRepository::FAMILIES)
        );
        $total = count($result['rows']);

        return Response::data([
            'success' => true,
            'data'    => array_slice($result['rows'], ($page - 1) * $perPage, $perPage),
            'meta'    => [
                'requestId'  => self::requestId(),
                'pagination' => [
                    'page'       => $page,
                    'perPage'    => $perPage,
                    'total'      => $total,
                    'totalPages' => (int) ceil($total / $perPage),
                ],
                // Ce que chaque famille a donné — ou pourquoi elle n'a rien donné.
                'sources'    => $result['sources'],
                'configured' => ErpClient::isConfigured(),
            ],
        ]);
    }

    /** @return array<string,mixed> */
    private function error(string $code, string $message, int $status): array
    {
        return Response::data([
            'success' => false,
            'error'   => ['code' => $code, 'message' => $message, 'details' => []],
            'meta'    => ['requestId' => self::requestId()],
        ], $status);
    }

    /** Identifiant de requête, repris de l'appelant s'il en a posé un. */
    private static function requestId(): string
    {
        $entrant = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';

        if (is_string($entrant) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $entrant) === 1) {
            return $entrant;
        }

        return sprintf('mar-%s', bin2hex(random_bytes(8)));
    }
}
