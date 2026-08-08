<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\SalesRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

/** Ventes réelles du réseau — l'historique qui éclaire les objectifs. */
final class SalesController
{
    public function __construct(private readonly SalesRepository $sales = new SalesRepository())
    {
    }

    /** Quantités vendues par boutique et par produit sur une période. */
    public function quantities(Request $request): array
    {
        $itemIds = array_values(array_filter(array_map(
            'intval',
            explode(',', (string) ($request->query['item_ids'] ?? ''))
        ), static fn (int $id): bool => $id > 0));

        // Bornes par défaut : le mois en cours. Le front les envoie toujours ;
        // le repli évite qu'une adresse forgée sans dates ne balaie tout.
        $from = (string) ($request->query['from'] ?? date('Y-m-01'));
        $to   = (string) ($request->query['to'] ?? date('Y-m-d'));

        foreach (['from' => $from, 'to' => $to] as $name => $value) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
                return Response::error(sprintf('Date « %s » invalide : attendu AAAA-MM-JJ.', $name));
            }
        }

        if ($to < $from) {
            return Response::error('La date de fin précède la date de début.');
        }

        return Response::data($this->sales->quantities(
            AuthContext::current(),
            $itemIds,
            $from,
            $to,
            in_array((string) ($request->query['compare'] ?? '0'), ['1', 'true'], true)
        ));
    }
}
