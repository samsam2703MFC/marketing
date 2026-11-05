<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\CampaignVoucherService;
use Marketing\Service\VoucherError;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les bons d'une campagne (sous-étape « Bons » de l'assistant).
 *
 * HTTP seulement : les règles sont dans CampaignVoucherService, les bons dans
 * l'ancien moteur du webshop. Lecture seule depuis le 05/11/2026 : les bons se
 * créent dans TFBuddy (ErpVoucherController). Un refus porte son statut (404).
 */
final class CampaignVoucherController
{
    public function __construct(
        private readonly CampaignVoucherService $vouchers = new CampaignVoucherService(),
    ) {
    }

    /** `GET …/campaigns/{id}/vouchers` — les bons suivis et ce qu'ils ont donné. */
    public function index(Request $request): array
    {
        return $this->run($request, fn (int $id): array => Response::data(
            $this->vouchers->forCampaign(AuthContext::current(), $id)
        ));
    }

    /** @param callable(int): array $action */
    private function run(Request $request, callable $action): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.', 422);
        }

        return $this->guard(static fn (): array => $action($id));
    }

    /** @param callable(): array $action */
    private function guard(callable $action): array
    {
        try {
            return $action();
        } catch (VoucherError $e) {
            return Response::error($e->getMessage(), $e->status);
        }
    }
}
