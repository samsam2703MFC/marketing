<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CampaignRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class CampaignController
{
    public function __construct(private readonly CampaignRepository $campaigns = new CampaignRepository())
    {
    }

    public function index(Request $request): array
    {
        $auth = AuthContext::current();

        return Response::data($this->campaigns->list($auth, [
            'status'   => $request->queryString('status'),
            'scope'    => $request->queryString('scope'),
            'brand_id' => $request->queryInt('brand_id'),
        ]));
    }

    public function show(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $campaign = $this->campaigns->find(AuthContext::current(), $id);

        return $campaign === null ? Response::notFound('Campagne introuvable.') : Response::data($campaign);
    }

    public function calendar(Request $request): array
    {
        $year = $request->queryInt('year', (int) date('Y'));

        return Response::data($this->campaigns->calendar(AuthContext::current(), $year));
    }

    public function monitor(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return Response::data($this->campaigns->monitor(AuthContext::current(), $id));
    }

    public function store(Request $request): array
    {
        $missing = $request->missing(['brand_id', 'name']);
        if ($missing !== []) {
            return Response::error('Champs obligatoires manquants.', 422, $missing);
        }

        $payload = $request->only([
            'brand_id', 'type_id', 'parent_campaign_id', 'name', 'scope', 'status_code',
            'starts_on', 'ends_on', 'budget_amount', 'owner_user_id', 'create_crm_leads', 'image_url',
        ]);

        $id = $this->campaigns->create(AuthContext::current(), $payload);

        return Response::created('Campagne créée.', $id);
    }

    public function update(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $payload = $request->only([
            'type_id', 'name', 'scope', 'status_code', 'starts_on', 'ends_on',
            'budget_amount', 'spent_amount', 'approval_status', 'create_crm_leads', 'image_url',
        ]);

        return $this->campaigns->update(AuthContext::current(), $id, $payload)
            ? Response::mutated('Campagne mise à jour.')
            : Response::notFound('Campagne introuvable.');
    }

    public function destroy(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return $this->campaigns->delete(AuthContext::current(), $id)
            ? Response::mutated('Campagne supprimée.')
            : Response::notFound('Campagne introuvable.');
    }
}
