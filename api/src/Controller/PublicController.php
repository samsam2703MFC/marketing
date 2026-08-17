<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\PublicCampaignRepository;
use Marketing\Support\Request;
use Marketing\Support\Response;
use RuntimeException;

/**
 * La seule façade publique du module : ce que la boutique en ligne affiche.
 *
 * Route neuve, donc écrite au format du standard (`docs/API_STANDARD.md`) et non
 * à celui du reste du module : enveloppe `{success, data, meta}`, erreurs à code
 * machine, `camelCase`, pagination, montants en unité mineure. Les 59 routes
 * existantes gardent leur forme jusqu'à la bascule `v2` — les mélanger casserait
 * le front sans rien améliorer. Celle-ci n'a pas d'antériorité à ménager : elle
 * montre la cible.
 */
final class PublicController
{
    public function __construct(
        private readonly PublicCampaignRepository $campaigns = new PublicCampaignRepository(),
    ) {
    }

    /**
     * Les campagnes en vitrine.
     *
     * @public Aucune authentification : c'est la vitrine. Rien d'interne n'en
     *         sort — la projection est explicite dans le dépôt, et la sélection
     *         se limite à ce qui a demandé à paraître.
     */
    public function campaigns(Request $request): array
    {
        try {
            $page = $this->campaigns->published([
                'page'     => $request->queryInt('page', 1),
                'perPage'  => $request->queryInt('perPage', 25),
                // Prévisualiser une date à venir : utile pour préparer une
                // vitrine avant son ouverture, sans rien publier d'avance.
                'activeOn' => $request->queryString('activeOn'),
            ]);
        } catch (RuntimeException $echec) {
            return $this->error('VALIDATION_FAILED', $echec->getMessage(), 422);
        }

        return Response::data([
            'success' => true,
            'data'    => $page['rows'],
            'meta'    => [
                'requestId'  => self::requestId(),
                'pagination' => [
                    'page'       => $page['page'],
                    'perPage'    => $page['perPage'],
                    'total'      => $page['total'],
                    'totalPages' => $page['perPage'] > 0
                        ? (int) ceil($page['total'] / $page['perPage'])
                        : 0,
                ],
            ],
        ]);
    }

    /** @return array<string,mixed> */
    private function error(string $code, string $message, int $status): array
    {
        return Response::data([
            'success' => false,
            'error'   => ['code' => $code, 'message' => $message, 'details' => []],
            'meta'    => ['requestId' => self::requestId()],
        ], $status);
    }

    /**
     * L'identifiant de requête, repris de l'appelant s'il en a posé un.
     *
     * Il ne sert à rien tant que le module ne journalise pas de façon
     * structurée — mais le contrat public le porte dès maintenant : l'ajouter
     * plus tard obligerait les appelants à changer, alors qu'un champ présent et
     * inexploité ne coûte rien.
     */
    private static function requestId(): string
    {
        $entrant = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';

        if (is_string($entrant) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $entrant) === 1) {
            return $entrant;
        }

        return sprintf('mar-%s', bin2hex(random_bytes(8)));
    }
}
