<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\CatalogRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/** Outils de campagne : promotions, bundles, vouchers. */
final class CatalogController
{
    public function __construct(private readonly CatalogRepository $catalog = new CatalogRepository())
    {
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
