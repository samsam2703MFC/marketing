<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CampaignRepository;
use Marketing\Repository\ProspectRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class CampaignController
{
    public function __construct(
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
        private readonly ProspectRepository $prospects = new ProspectRepository(),
    ) {
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
            'brand_id', 'type_id', 'parent_campaign_id', 'name', 'scope', 'client_target', 'tone',
            'status_code', 'draft_step', 'starts_on', 'ends_on', 'budget_amount', 'objective_coef_pct',
            'agency_note', 'b2b_webshop_enabled', 'pos_survey_enabled', 'pos_questions',
            'owner_user_id', 'create_crm_leads',
            'image_url', 'focal_point_y', 'shop_ids', 'shop_targets', 'channels', 'lever_targets',
            'sector_ids', 'agency_ask_ids', 'b2b_option_ids', 'uniform_ids', 'format_ids',
            'retroplanning', 'offer',
            'challenge_enabled', 'challenge_metric', 'challenge_trigger_pct', 'challenge_prizes',
        ]);

        $auth = AuthContext::current();
        $id   = $this->campaigns->createWithRelations($auth, $payload);

        // La génération vient après le commit, et non dans la transaction de
        // création : un vivier vide ne doit pas annuler la campagne. Une
        // campagne sans ses leads se rattrape en relançant la génération ;
        // une campagne perdue parce que le vivier n'était pas encore importé,
        // non.
        $leads = null;
        if (!empty($payload['create_crm_leads'])) {
            $leads = $this->prospects->generateLeads($auth, $id);
        }

        $response = Response::created('Campagne créée.', $id);
        if ($leads !== null) {
            $response['body']['leads'] = $leads;
        }

        return $response;
    }

    /**
     * Brouillon relu pour être repris dans l'assistant.
     *
     * Route distincte de `show` : celle-ci sert le suivi et rend des libellés,
     * là où l'assistant a besoin des identifiants pour recocher ce qui l'était.
     */
    public function draft(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $draft = $this->campaigns->draft(AuthContext::current(), $id);

        return $draft === null ? Response::notFound('Campagne introuvable.') : Response::data($draft);
    }

    /**
     * Reprise : la campagne et l'ensemble de ses rattachements.
     *
     * Même charge utile que la création. L'assistant n'a pas à savoir s'il
     * enregistre pour la première fois ou la dixième — c'est la présence d'un
     * identifiant qui décide, et rien d'autre.
     */
    public function replace(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $payload = $request->only([
            'type_id', 'name', 'scope', 'client_target', 'tone', 'status_code', 'draft_step',
            'starts_on', 'ends_on', 'budget_amount', 'objective_coef_pct',
            'agency_note', 'b2b_webshop_enabled', 'pos_survey_enabled', 'pos_questions',
            'create_crm_leads', 'image_url', 'focal_point_y', 'shop_ids', 'shop_targets', 'channels',
            'lever_targets', 'sector_ids', 'agency_ask_ids', 'b2b_option_ids',
            'uniform_ids', 'format_ids', 'retroplanning', 'offer',
            'challenge_enabled', 'challenge_metric', 'challenge_trigger_pct', 'challenge_prizes',
        ]);

        return $this->campaigns->updateWithRelations(AuthContext::current(), $id, $payload)
            ? Response::mutated('Brouillon enregistré.')
            : Response::notFound('Campagne introuvable.');
    }

    public function update(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $payload = $request->only([
            'type_id', 'name', 'scope', 'client_target', 'tone', 'status_code',
            'starts_on', 'ends_on', 'budget_amount', 'objective_coef_pct', 'agency_note',
            'b2b_webshop_enabled', 'pos_survey_enabled', 'spent_amount', 'approval_status',
            'create_crm_leads', 'image_url',
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
