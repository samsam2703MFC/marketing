<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CampaignTypeRepository;
use Marketing\Repository\ReferenceRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class ReferenceController
{
    public function __construct(
        private readonly ReferenceRepository $references = new ReferenceRepository(),
        private readonly CampaignTypeRepository $types = new CampaignTypeRepository(),
    ) {
    }

    /** Tous les référentiels en un appel — remplace les tableaux en dur du prototype. */
    public function index(Request $request): array
    {
        unset($request);

        return Response::data($this->references->all());
    }

    public function brands(Request $request): array
    {
        unset($request);

        return Response::data($this->references->brands());
    }

    /** Boutiques visibles par l'appelant — l'étape « périmètre » de l'assistant. */
    public function shops(Request $request): array
    {
        unset($request);

        return Response::data($this->references->shops(AuthContext::current()));
    }

    // -------------------------------------------------------------------------
    // Types de campagne
    //
    // Réservés à la marque. Un type structure le réseau entier : le renommer
    // change ce que voient toutes les boutiques, et deux franchisés qui créent
    // le même type sous deux noms font perdre son sens au suivi par type.
    // -------------------------------------------------------------------------

    public function campaignTypes(Request $request): array
    {
        unset($request);

        return Response::data($this->types->all());
    }

    public function storeCampaignType(Request $request): array
    {
        if (($refus = $this->reserveALaMarque()) !== null) {
            return $refus;
        }

        $missing = $request->missing(['label']);
        if ($missing !== []) {
            return Response::error('Le nom du type est obligatoire.', 422, $missing);
        }

        return Response::created(
            'Type de campagne créé.',
            $this->types->create(AuthContext::current(), $request->only([
                'code', 'label', 'description', 'color_hex', 'icon_key',
                'lever_id', 'lever_badge_label', 'default_kpi_label',
            ]))
        );
    }

    public function updateCampaignType(Request $request): array
    {
        if (($refus = $this->reserveALaMarque()) !== null) {
            return $refus;
        }

        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de type invalide.');
        }

        return $this->types->update($id, $request->only([
            'label', 'description', 'color_hex', 'icon_key',
            'lever_id', 'lever_badge_label', 'default_kpi_label', 'is_active',
        ]))
            ? Response::mutated('Type de campagne enregistré.')
            : Response::notFound('Type de campagne introuvable.');
    }

    public function destroyCampaignType(Request $request): array
    {
        if (($refus = $this->reserveALaMarque()) !== null) {
            return $refus;
        }

        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de type invalide.');
        }

        $bilan = $this->types->delete($id);

        if (!$bilan['deleted'] && $bilan['campaigns'] > 0) {
            // Le compte est dans le message : « impossible de supprimer » sans
            // dire combien de campagnes s'y opposent envoie chercher au hasard.
            return Response::error(sprintf(
                '%d campagne%s utilise%s ce type : désactivez-le pour le retirer des choix '
                . 'sans toucher à leur historique.',
                $bilan['campaigns'],
                $bilan['campaigns'] > 1 ? 's' : '',
                $bilan['campaigns'] > 1 ? 'nt' : ''
            ), 409);
        }

        return $bilan['deleted']
            ? Response::mutated('Type de campagne supprimé.')
            : Response::notFound('Type de campagne introuvable.');
    }

    public function reorderCampaignTypes(Request $request): array
    {
        if (($refus = $this->reserveALaMarque()) !== null) {
            return $refus;
        }

        $ids = $request->input('ids');
        if (!is_array($ids) || $ids === []) {
            return Response::error('Aucun ordre reçu.', 422);
        }

        return Response::data(['reordered' => $this->types->reorder($ids)]);
    }

    /** @return array<string,mixed>|null */
    private function reserveALaMarque(): ?array
    {
        return AuthContext::current()->isBrandAdmin()
            ? null
            : Response::forbidden('Les types de campagne sont gérés par la marque.');
    }
}
