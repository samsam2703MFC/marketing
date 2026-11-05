<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Service\ErpVoucherService;
use Marketing\Service\VoucherError;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;

/**
 * Les bons d'une campagne dans TFBuddy (ErpVoucherService). HTTP seulement ; au format du standard.
 */
final class ErpVoucherController
{
    public function __construct(private readonly ErpVoucherService $service = new ErpVoucherService())
    {
    }

    /** GET /campaigns/{id}/erp-vouchers */
    public function index(Request $request): array
    {
        return $this->run(fn () => Envelope::ok($this->service->forCampaign(AuthContext::current(), (int) $request->intParam('id'))));
    }

    /** POST /campaigns/{id}/erp-vouchers */
    public function store(Request $request): array
    {
        $checked = $this->service->validate($request->body);
        if ($checked['errors'] !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Bon invalide.', 422, $checked['errors']);
        }

        return $this->run(fn () => Envelope::ok($this->service->create(AuthContext::current(), (int) $request->intParam('id'), $checked['input']), [], 201));
    }

    /** PATCH /campaigns/{id}/erp-vouchers/{voucherId} {status: ACTIVE | INACTIVE} */
    public function update(Request $request): array
    {
        $errors = [];
        foreach (array_diff(array_keys($request->body), ['status']) as $k) {
            $errors[] = ['field' => (string) $k, 'message' => 'Champ inconnu.'];
        }
        $status = $request->body['status'] ?? null;
        if (!in_array($status, ['ACTIVE', 'INACTIVE'], true)) {
            $errors[] = ['field' => 'status', 'message' => 'ACTIVE ou INACTIVE.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Mise à jour du bon invalide.', 422, $errors);
        }

        return $this->run(fn () => Envelope::ok($this->service->setStatus(AuthContext::current(), (int) $request->intParam('id'),
            (int) $request->intParam('voucherId'), (string) $status)));
    }

    private function run(callable $f): array
    {
        try {
            return $f();
        } catch (VoucherError $e) {
            $code = match ($e->status) {
                403 => 'PERM_ROLE_REQUIRED', 404 => 'RESOURCE_NOT_FOUND', 409 => 'RESOURCE_STATE_INVALID',
                503, 502 => 'DEPENDENCY_UNAVAILABLE', default => 'VALIDATION_FAILED',
            };
            return Envelope::error($code, $e->getMessage(), $e->status);
        }
    }
}
