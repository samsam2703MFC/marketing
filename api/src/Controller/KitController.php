<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CampaignRepository;
use Marketing\Repository\KitRepository;
use Marketing\Repository\ProductionRepository;
use Marketing\Service\KitService;
use Marketing\Service\MediaService;
use Marketing\Service\ProductionService;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;

/**
 * Le kit des franchisés. Côté réseau : ses versions, le lien et la lecture de
 * chaque boutique, l'aperçu, l'envoi. Côté boutique (route publique, par le
 * lien personnel) : la lecture et l'accusé de lecture.
 */
final class KitController
{
    public function __construct(
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
        private readonly ProductionRepository $production = new ProductionRepository(),
        private readonly ProductionService $productionService = new ProductionService(),
        private readonly KitRepository $kits = new KitRepository(),
        private readonly KitService $service = new KitService(),
    ) {
    }

    /** GET /campaigns/{id}/kit-versions */
    public function index(Request $request): array
    {
        $auth = AuthContext::current();
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }
        $id       = (int) $campaign['id'];
        $built    = $this->productionService->build($auth, $campaign);
        $versions = $this->kits->versions($id);
        $current  = $versions[0]['version'] ?? null;
        $reads    = $current !== null ? $this->kits->reads($id, $current) : [];
        $links    = $this->kits->links($id);
        $shops = [];
        foreach ($built['shops'] as $shop) {
            $sid  = $shop['shopId'];
            $link = $links[$sid] ?? null;
            $token = $link !== null ? $this->service->token($id, $sid, (string) $link['salt']) : null;
            $shops[] = [
                'shopId'    => $sid,
                'shopName'  => $shop['shopName'],
                'url'       => $token !== null ? MediaService::publicUrl('') . '?kit=' . $token : null,
                'expiresOn' => $link['expires_on'] ?? null,
                'sent'      => isset($reads[$sid]),
                'readAt'    => isset($reads[$sid]['read_at']) ? $this->iso((string) $reads[$sid]['read_at']) : null,
            ];
        }

        return Envelope::ok([
            'campaignId'     => $id,
            'kitReady'       => $built['kitReady'],
            'validated'      => $built['validated'],
            'total'          => $built['total'],
            'currentVersion' => $current,
            'versions'       => array_map(fn ($v) => ['version' => $v['version'], 'createdAt' => $this->iso($v['created_at'])], $versions),
            'shops'          => $shops,
        ]);
    }

    /** POST /campaigns/{id}/kit-versions — fige et envoie une version. */
    public function store(Request $request): array
    {
        $auth = AuthContext::current();
        if (!$auth->isBrandAdmin()) {
            return Envelope::error('PERM_ROLE_REQUIRED', 'Le kit s’envoie depuis le réseau.', 403);
        }
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }
        $unknown = array_diff(array_keys($request->body), ['posts']);
        $checked = $this->service->validatePosts($request->body['posts'] ?? null);
        $errors  = array_merge(array_map(static fn ($k) => ['field' => (string) $k, 'message' => 'Champ inconnu.'], array_values($unknown)), $checked['errors']);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Envoi du kit invalide.', 422, $errors);
        }
        $built = $this->productionService->build($auth, $campaign);
        if (!$built['kitReady']) {
            $left = $built['total'] - $built['validated'];
            return Envelope::error('RESOURCE_STATE_INVALID', sprintf(
                'Le kit s’envoie quand toutes les sections sont validées : il en reste %d.', $left
            ), 409);
        }
        $id    = (int) $campaign['id'];
        $shops = $this->production->shops($id, (int) $campaign['brand_id']);
        if ($shops === []) {
            return Envelope::error('RESOURCE_STATE_INVALID', 'La campagne ne vise aucune boutique.', 409);
        }
        if ($this->service->token($id, (int) $shops[0]['id'], 'essai') === null) {
            return Envelope::error('DEPENDENCY_UNAVAILABLE', 'MAR_SESSION_SECRET n’est pas renseigné : les liens des boutiques ne peuvent pas être signés.', 503);
        }
        $payloads = [];
        foreach ($shops as $shop) {
            $payloads[(int) $shop['id']] = (string) json_encode(
                $this->service->build($campaign, $built, $shop, $checked['posts']),
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
            );
        }
        $version = $this->kits->createVersion($id, $payloads, $auth->userId);
        $links   = $this->kits->links($id);
        $expires = KitService::expiresOn($campaign['ends_on'] ?? null);
        foreach ($shops as $shop) {
            $sid  = (int) $shop['id'];
            $salt = isset($links[$sid]) ? (string) $links[$sid]['salt'] : KitService::newSalt();
            $token = (string) $this->service->token($id, $sid, $salt);
            $this->kits->saveLink($id, $sid, $salt, KitService::tokenHash($token), $expires);
        }

        $response = $this->index($request);
        $response['status'] = 201;
        $response['body']['data']['createdVersion'] = $version;

        return $response;
    }

    /** GET /campaigns/{id}/kit-previews/{shopId} — le kit tel qu'il partirait (sans les posts, que l'écran lit dans Social). */
    public function preview(Request $request): array
    {
        $auth = AuthContext::current();
        [$campaign, $error] = $this->campaign($auth, $request);
        if ($error !== null) {
            return $error;
        }
        $shopId = $request->intParam('shopId');
        $only   = $auth->isBrandAdmin() ? null : $auth->shopIds;
        $shop   = null;
        foreach ($this->production->shops((int) $campaign['id'], (int) $campaign['brand_id'], $only) as $row) {
            if ((int) $row['id'] === $shopId) {
                $shop = $row;
            }
        }
        if ($shop === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Boutique introuvable dans cette campagne.', 404);
        }
        $built = $this->productionService->build($auth, $campaign);

        return Envelope::ok(['version' => null, 'createdAt' => null, 'readAt' => null]
            + $this->service->build($campaign, $built, $shop, []));
    }

    /** GET /api/v1/public/marketing/campaign-kits/{token} */
    public function show(Request $request): array
    {
        $kit = $this->byToken($request);
        if ($kit === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Ce lien ne mène à aucun kit, ou il a expiré.', 404);
        }
        $payload = json_decode($kit['payload'], true);

        return Envelope::ok([
            'version'   => $kit['version'],
            'createdAt' => $this->iso($kit['created_at']),
            'readAt'    => $kit['read_at'] !== null ? $this->iso((string) $kit['read_at']) : null,
        ] + (is_array($payload) ? $payload : []));
    }

    /** PUT /api/v1/public/marketing/campaign-kits/{token}/read-receipt — idempotent : la première lecture reste. */
    public function read(Request $request): array
    {
        $kit = $this->byToken($request);
        if ($kit === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Ce lien ne mène à aucun kit, ou il a expiré.', 404);
        }
        $this->kits->markRead($kit['campaign_id'], $kit['shop_id'], $kit['version']);
        $again = $this->byToken($request);

        return Envelope::ok(['version' => $kit['version'], 'readAt' => $again !== null && $again['read_at'] !== null ? $this->iso((string) $again['read_at']) : null]);
    }

    private function byToken(Request $request): ?array
    {
        $token = (string) $request->param('token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            return null;
        }

        return $this->kits->byToken(KitService::tokenHash($token), gmdate('Y-m-d'));
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
            return [null, Envelope::error('RESOURCE_STATE_INVALID', 'La campagne n’est pas encore validée.', 409)];
        }

        return [$campaign, null];
    }

    /** Dates écrites en UTC par le module (gmdate). */
    private function iso(string $datetime): string
    {
        return str_replace(' ', 'T', substr($datetime, 0, 19)) . 'Z';
    }
}
