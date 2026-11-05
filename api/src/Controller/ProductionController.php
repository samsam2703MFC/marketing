<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CampaignRepository;
use Marketing\Repository\ProductionRepository;
use Marketing\Service\ProductionService;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;

/**
 * Fil de production d'une campagne validée. HTTP seulement : la composition
 * des sections est dans ProductionService, le SQL dans ProductionRepository.
 *
 * Le réseau fait avancer chaque section ; un franchisé lit le fil de ses
 * boutiques et valide (ou renvoie, avec son retour) le BAT de ses bâches et de
 * ses affiches.
 */
final class ProductionController
{
    public function __construct(
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
        private readonly ProductionRepository $production = new ProductionRepository(),
        private readonly ProductionService $service = new ProductionService(),
    ) {
    }

    public function index(Request $request): array
    {
        $auth = AuthContext::current();
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }

        return Envelope::ok($this->payload($auth, $campaign));
    }

    public function update(Request $request): array
    {
        $auth = AuthContext::current();
        if (!$auth->isBrandAdmin()) {
            return Envelope::error('PERM_ROLE_REQUIRED', 'Les sections de la campagne avancent depuis le réseau.', 403);
        }
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }
        $built   = $this->service->build($auth, $campaign);
        $section = $this->section($built, (string) $request->param('section'));
        if ($section === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Cette section ne fait pas partie de la campagne.', 404);
        }
        $checked = $this->service->validateState($request->body, ProductionService::STATUSES);
        if ($checked['errors'] !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Mise à jour de la section invalide.', 422, $checked['errors']);
        }
        if ($checked['status'] === 'validated' && $section['perShop']) {
            $missing = count($section['shops']) - (int) ($section['shopsValidated'] ?? 0);
            if ($missing > 0) {
                return Envelope::error('RESOURCE_STATE_INVALID', sprintf(
                    '%d boutique%s n’%s pas encore validé son BAT.', $missing, $missing > 1 ? 's' : '', $missing > 1 ? 'ont' : 'a'
                ), 409);
            }
        }
        $this->production->saveState((int) $campaign['id'], $section['code'], $checked['status'], $checked['note'], $auth->userId);

        return Envelope::ok($this->payload($auth, $campaign));
    }

    public function updateShop(Request $request): array
    {
        $auth = AuthContext::current();
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }
        $built   = $this->service->build($auth, $campaign);
        $section = $this->section($built, (string) $request->param('section'));
        if ($section === null || !$section['perShop']) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Cette section ne se valide pas boutique par boutique.', 404);
        }
        $shopId = $request->intParam('shopId');
        $shopIds = array_map(static fn ($s) => $s['shopId'], $section['shops']);
        if ($shopId === null || !in_array($shopId, $shopIds, true)) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Boutique introuvable dans cette campagne.', 404);
        }
        // Le franchisé valide ou renvoie son BAT ; l'envoi et la remise à zéro sont gestes du réseau.
        $allowed = $auth->isBrandAdmin() ? ProductionService::SHOP_STATUSES : ['validated', 'redo'];
        $checked = $this->service->validateState($request->body, $allowed);
        if ($checked['errors'] !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Mise à jour du BAT invalide.', 422, $checked['errors']);
        }
        $this->production->saveShopState((int) $campaign['id'], $section['code'], $shopId, $checked['status'], $checked['note'], $auth->userId);

        return Envelope::ok($this->payload($auth, $campaign));
    }

    /** @return array{0: ?array<string,mixed>, 1: ?array} */
    private function campaign(AuthContext $auth, Request $request): array
    {
        $id = $request->intParam('id');
        $campaign = $id === null ? null : $this->campaigns->find($auth, $id);
        if ($campaign === null) {
            return [null, Envelope::error('RESOURCE_NOT_FOUND', 'Campagne introuvable.', 404)];
        }
        if (($campaign['status_code'] ?? '') === 'draft') {
            return [null, Envelope::error('RESOURCE_STATE_INVALID', 'La campagne n’est pas encore validée : sa production commence à la validation.', 409)];
        }

        return [$campaign, null];
    }

    /** @param array<string,mixed> $campaign */
    private function payload(AuthContext $auth, array $campaign): array
    {
        $built = $this->service->build($auth, $campaign);

        return [
            'campaignId' => (int) $campaign['id'],
            'startsOn'   => $campaign['starts_on'] ?? null,
            'endsOn'     => $campaign['ends_on'] ?? null,
        ] + $built;
    }

    /** @param array{sections: list<array<string,mixed>>} $built */
    private function section(array $built, string $code): ?array
    {
        foreach ($built['sections'] as $section) {
            if ($section['code'] === $code) {
                return $section;
            }
        }

        return null;
    }
}
