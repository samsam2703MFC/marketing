<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CatalogRepository;
use Marketing\Repository\PriceListRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/** Outils de campagne : promotions, bundles, vouchers. */
final class CatalogController
{
    public function __construct(
        private readonly CatalogRepository $catalog = new CatalogRepository(),
        private readonly PriceListRepository $prices = new PriceListRepository(),
    ) {
    }

    /**
     * Prix de vente des produits demandés : tarif boutique, ou catalogue.
     *
     * L'étape « Prix » s'en sert comme prix de départ de sa simulation. Aucune
     * borne de date : un tarif est celui du jour, contrairement aux volumes.
     */
    public function priceList(Request $request): array
    {
        $itemIds = array_values(array_filter(array_map(
            'intval',
            explode(',', (string) ($request->query['item_ids'] ?? ''))
        ), static fn (int $id): bool => $id > 0));

        return Response::data($this->prices->forItems(AuthContext::current(), $itemIds));
    }

    /** Références actives du catalogue, pour l'étape « Offre » de l'assistant. */
    public function offerItems(Request $request): array
    {
        unset($request);

        return Response::data($this->catalog->offerItems());
    }

    public function promotions(Request $request): array
    {
        unset($request);

        return Response::data($this->catalog->promotions(AuthContext::current()));
    }

    /** Offres montées dans l'assistant, à côté des promotions du catalogue. */
    public function campaignOffers(Request $request): array
    {
        unset($request);

        return Response::data($this->catalog->campaignOffers(AuthContext::current()));
    }

    public function bundles(Request $request): array
    {
        unset($request);

        return Response::data($this->catalog->bundles());
    }

    public function vouchers(Request $request): array
    {
        unset($request);

        return Response::data($this->catalog->vouchers(AuthContext::current()));
    }
}
