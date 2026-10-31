<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\BrochureRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Les brochures d'une campagne : les réglages du générateur (leaflet A5, dépliant A4 3 volets).
 *
 * Le contenu imprimé se lit par le dossier d'impression (`GET …/campaigns/{id}/print`) ; ces routes
 * ne portent que les choix de la brochure.
 */
final class BrochureController
{
    public function __construct(
        private readonly BrochureRepository $brochures = new BrochureRepository(),
    ) {
    }

    /** `GET …/campaigns/{id}/brochures` : les réglages enregistrés, un par format. */
    public function index(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        $list = $this->brochures->forCampaign(AuthContext::current(), $id);

        return $list === null ? Response::notFound('Campagne introuvable.') : Response::data($list);
    }

    /** `PUT …/campaigns/{id}/brochures/{format}` : `{ "settings": {…} }` remplace les réglages du format. */
    public function save(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return $this->brochures->save(AuthContext::current(), $id, (string) $request->param('format'), $request->input('settings'))
            ? Response::mutated('Brochure enregistrée.')
            : Response::notFound('Campagne introuvable.');
    }
}
