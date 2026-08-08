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
        // La marque ne fait plus partie de la saisie : le back-office la connaît.
        // Le dépôt la résout, et refuse explicitement si elle reste ambiguë.
        $missing = $request->missing(['name']);
        if ($missing !== []) {
            return Response::error('Champs obligatoires manquants.', 422, $missing);
        }

        // L'assistant en sept étapes envoie la campagne et ses rattachements en
        // un seul appel : le périmètre, les canaux et les objectifs font partie
        // de la campagne, pas d'une seconde étape que l'on pourrait rater.
        $payload = $request->only([
            'brand_id', 'type_id', 'parent_campaign_id', 'name', 'scope', 'client_target',
            'status_code', 'starts_on', 'ends_on', 'budget_amount', 'owner_user_id',
            'create_crm_leads', 'image_url', 'shop_ids', 'channels', 'lever_targets',
        ]);

        $id = $this->campaigns->createWithRelations(AuthContext::current(), $payload);

        return Response::created('Campagne créée.', $id);
    }

    public function update(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $payload = $request->only([
            'type_id', 'name', 'scope', 'client_target', 'status_code', 'starts_on', 'ends_on',
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
