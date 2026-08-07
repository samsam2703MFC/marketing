<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\LeadRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class LeadController
{
    public function __construct(private readonly LeadRepository $leads = new LeadRepository())
    {
    }

    public function index(Request $request): array
    {
        $campaignId = $request->intParam('id');
        if ($campaignId === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return Response::data([
            'leads'  => $this->leads->listByCampaign(AuthContext::current(), $campaignId),
            'funnel' => $this->leads->funnel($campaignId),
        ]);
    }

    public function updateStatus(Request $request): array
    {
        $leadId = $request->intParam('id');
        if ($leadId === null) {
            return Response::error('Identifiant de lead invalide.');
        }

        $status = $request->input('status_code');
        if (!is_string($status) || $status === '') {
            return Response::error('Le champ status_code est requis.', 422);
        }

        $note = $request->input('note');
        $this->leads->changeStatus(
            AuthContext::current(),
            $leadId,
            $status,
            is_string($note) && $note !== '' ? $note : null
        );

        return Response::mutated('État du lead mis à jour.');
    }

    public function history(Request $request): array
    {
        $leadId = $request->intParam('id');
        if ($leadId === null) {
            return Response::error('Identifiant de lead invalide.');
        }

        return Response::data($this->leads->history($leadId));
    }
}
