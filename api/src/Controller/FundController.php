<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\ErpRoyaltyRepository;
use Marketing\Repository\FundRepository;
use Marketing\Repository\RoyaltyRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class FundController
{
    public function __construct(
        private readonly FundRepository $funds = new FundRepository(),
        private readonly RoyaltyRepository $royalties = new RoyaltyRepository(),
        private readonly ErpRoyaltyRepository $erpRoyalties = new ErpRoyaltyRepository(),
    ) {
    }

    public function ledger(Request $request): array
    {
        return Response::data($this->funds->ledger(AuthContext::current(), [
            'granularity' => $request->queryEnum('granularity', ['month', 'quarter', 'year'], 'month'),
            'from'        => $request->queryString('from'),
            'to'          => $request->queryString('to'),
        ]));
    }

    public function leverSummary(Request $request): array
    {
        unset($request);

        return Response::data($this->funds->leverSummary());
    }

    public function roiQuarterly(Request $request): array
    {
        unset($request);

        return Response::data($this->funds->roiQuarterly());
    }

    public function roiCosts(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return Response::data($this->funds->roiCosts($id));
    }

    public function storeMovement(Request $request): array
    {
        $missing = $request->missing(['direction', 'movement_date', 'label', 'amount']);
        if ($missing !== []) {
            return Response::error('Champs obligatoires manquants.', 422, $missing);
        }

        $auth   = AuthContext::current();
        $shopId = $request->input('shop_id');

        // Un franchisé ne peut imputer une dépense qu'à ses propres boutiques.
        if ($shopId !== null && !\Marketing\Support\Scope::allowsShop($auth, (int) $shopId)) {
            return Response::forbidden('Boutique hors périmètre.');
        }

        $id = $this->funds->addMovement($auth, $request->only([
            'direction', 'shop_id', 'campaign_id', 'lever_id', 'movement_date',
            'period_from', 'period_to',
            'label', 'amount', 'source', 'supplier_name', 'document_ref',
        ]));

        return Response::created('Mouvement enregistré.', $id);
    }

    public function updateMovement(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de mouvement invalide.');
        }

        $missing = $request->missing(['direction', 'movement_date', 'label', 'amount']);
        if ($missing !== []) {
            return Response::error('Champs obligatoires manquants.', 422, $missing);
        }

        $auth   = AuthContext::current();
        $shopId = $request->input('shop_id');

        if ($shopId !== null && !\Marketing\Support\Scope::allowsShop($auth, (int) $shopId)) {
            return Response::forbidden('Boutique hors périmètre.');
        }

        return $this->funds->updateMovement($auth, $id, $request->only([
            'direction', 'shop_id', 'campaign_id', 'lever_id', 'movement_date',
            'period_from', 'period_to',
            'label', 'amount', 'source', 'supplier_name', 'document_ref',
        ]))
            ? Response::mutated('Mouvement corrigé.')
            : Response::notFound('Mouvement introuvable.');
    }

    public function destroyMovement(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de mouvement invalide.');
        }

        return $this->funds->deleteMovement(AuthContext::current(), $id)
            ? Response::mutated('Mouvement supprimé.')
            : Response::notFound('Mouvement introuvable.');
    }

    public function recurrences(Request $request): array
    {
        unset($request);

        return Response::data($this->funds->recurrences(AuthContext::current()));
    }

    public function storeRecurrence(Request $request): array
    {
        $missing = $request->missing(['direction', 'frequency', 'label', 'amount', 'starts_on', 'ends_on']);
        if ($missing !== []) {
            return Response::error('Champs obligatoires manquants.', 422, $missing);
        }

        $auth   = AuthContext::current();
        $shopId = $request->input('shop_id');

        if ($shopId !== null && !\Marketing\Support\Scope::allowsShop($auth, (int) $shopId)) {
            return Response::forbidden('Boutique hors périmètre.');
        }

        $resultat = $this->funds->addRecurrence($auth, $request->only([
            'direction', 'frequency', 'shop_id', 'campaign_id', 'lever_id',
            'starts_on', 'ends_on', 'label', 'amount', 'source',
            'supplier_name', 'document_ref',
        ]));

        // Le nombre d'échéances écrites fait partie de la réponse : l'écran
        // l'annonce, et « 12 écritures » n'est pas la même nouvelle que « 1 ».
        return Response::data([
            'message'      => 'Frais récurrent enregistré.',
            'inserted_id'  => $resultat['id'],
            'occurrences'  => $resultat['occurrences'],
            'total_amount' => $resultat['total_amount'],
        ], 201);
    }

    // -------------------------------------------------------------------------
    // Redevances
    // -------------------------------------------------------------------------

    public function royalties(Request $request): array
    {
        $mois = $request->queryString('month') ?? date('Y-m');

        return Response::data($this->royalties->board(AuthContext::current(), $mois));
    }

    public function saveRoyalties(Request $request): array
    {
        $mois = (string) ($request->input('month') ?? '');
        $auth = AuthContext::current();

        // Les taux et les CA partent ensemble depuis l'écran : les séparer en
        // deux appels laisserait l'un enregistré et l'autre perdu si la page se
        // ferme entre les deux, et la génération lirait une grille à moitié à
        // jour sans que rien ne le dise.
        $taux = $this->royalties->saveRates($auth, $mois, $request->input('rates') ?? []);
        $ca   = $this->royalties->saveRevenues($auth, $mois, $request->input('revenues') ?? []);

        return Response::data([
            'message'         => 'Grille enregistrée.',
            'rates_changed'   => $taux['changed'],
            'rates_unchanged' => $taux['unchanged'],
            'revenues_saved'  => $ca['saved'],
            'revenues_cleared' => $ca['cleared'],
        ]);
    }

    public function generateRoyalties(Request $request): array
    {
        $mois   = (string) ($request->input('month') ?? '');
        $kinds  = $request->input('kinds') ?? [];

        return Response::data(
            $this->royalties->generate(AuthContext::current(), $mois, is_array($kinds) ? $kinds : []),
            201
        );
    }

    /**
     * Ce que l'ERP a facturé ce mois-là, et comment le module le comprend.
     *
     * Répond toujours 200, même quand la lecture échoue : « la table n'existe
     * pas », « la colonne du montant n'a pas été reconnue » sont des réponses
     * utiles, pas des erreurs de l'appelant. L'écran les affiche telles quelles.
     */
    public function erpRoyalties(Request $request): array
    {
        $mois = $request->queryString('month') ?? date('Y-m');

        return Response::data($this->erpRoyalties->preview(AuthContext::current(), $mois));
    }

    public function importErpRoyalties(Request $request): array
    {
        $mois = (string) ($request->input('month') ?? '');

        return Response::data($this->erpRoyalties->import(AuthContext::current(), $mois), 201);
    }

    public function destroyRecurrence(Request $request): array
    {
        $id = $request->intParam('id');
        if ($id === null) {
            return Response::error('Identifiant de frais récurrent invalide.');
        }

        return $this->funds->deleteRecurrence(AuthContext::current(), $id)
            ? Response::mutated('Frais récurrent supprimé.')
            : Response::notFound('Frais récurrent introuvable.');
    }
}
