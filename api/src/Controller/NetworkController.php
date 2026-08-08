<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\AgencyRepository;
use Marketing\Repository\DiffusionRepository;
use Marketing\Repository\FundRepository;
use Marketing\Repository\NetworkRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/** Diffusion, agences, performance et écrans réseau. */
final class NetworkController
{
    public function __construct(
        private readonly AgencyRepository $agencies = new AgencyRepository(),
        private readonly DiffusionRepository $diffusion = new DiffusionRepository(),
        private readonly NetworkRepository $network = new NetworkRepository(),
        private readonly FundRepository $funds = new FundRepository(),
    ) {
    }

    public function agencies(Request $request): array
    {
        unset($request);

        return Response::data($this->agencies->agencies());
    }

    public function interventions(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant d\'agence invalide.');
        }

        return Response::data($this->agencies->interventions($id));
    }

    /** Pub physique & PLV, et Pub digitale : même lecture, familles différentes. */
    public function diffusion(Request $request): array
    {
        $family = $request->queryEnum('family', ['PHYSIQUE', 'DIGITAL'], 'PHYSIQUE');
        $auth   = AuthContext::current();

        return Response::data([
            'channels' => $this->diffusion->channels($auth, $family),
            'renders'  => $family === 'DIGITAL' ? $this->diffusion->renders($auth) : [],
            'uniforms' => $family === 'PHYSIQUE' ? $this->diffusion->uniforms($auth) : [],
        ]);
    }

    /** Marketing Analyse : performance par levier et postes de coût. */
    public function analysis(Request $request): array
    {
        unset($request);

        return Response::data([
            'levers' => $this->funds->leverSummary(),
            'costs'  => $this->agencies->costsByKind(),
        ]);
    }

    /** ROI & rentabilité : coût pour +1 000 € de CA, par trimestre. */
    public function roi(Request $request): array
    {
        unset($request);

        return Response::data([
            'quarterly' => $this->funds->roiQuarterly(),
            'costs'     => $this->agencies->costsByKind(),
        ]);
    }

    public function crm(Request $request): array
    {
        unset($request);

        return Response::data([
            'segments' => $this->network->segments(),
            'summary'  => $this->network->customerSummary(AuthContext::current()),
        ]);
    }

    public function presence(Request $request): array
    {
        unset($request);
        $auth = AuthContext::current();

        return Response::data([
            'shops'   => $this->network->presence($auth),
            'reviews' => $this->network->reviews($auth),
        ]);
    }

    public function kits(Request $request): array
    {
        unset($request);

        return Response::data($this->network->kits(AuthContext::current()));
    }
}
