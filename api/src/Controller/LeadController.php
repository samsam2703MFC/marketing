<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\LeadRepository;
use Marketing\Repository\ErpSyncRepository;
use Marketing\Repository\ProspectRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Request;
use Marketing\Support\Response;

final class LeadController
{
    public function __construct(
        private readonly LeadRepository $leads = new LeadRepository(),
        private readonly ProspectRepository $prospects = new ProspectRepository(),
        private readonly ErpSyncRepository $erp = new ErpSyncRepository(),
    ) {
    }

    /**
     * Reprend les boutiques et les comptes professionnels depuis l'ERP.
     *
     * Réservé au réseau : ces deux jeux sont communs à toutes les boutiques, et
     * une reprise partielle lancée depuis une boutique laisserait le réseau
     * dans un état qu'aucun écran ne saurait expliquer.
     */
    public function syncErp(Request $request): array
    {
        $auth = AuthContext::current();
        if (!$auth->isBrandAdmin()) {
            return Response::error('La reprise ERP est gérée au niveau du réseau.', 403);
        }

        $brandId = $request->input('brand_id');

        return Response::data($this->erp->sync(
            $auth,
            is_numeric($brandId) ? (int) $brandId : $this->defaultBrandId()
        ));
    }

    /** Effectif réel du vivier par secteur, face au chiffre de cadrage. */
    public function sectorSummary(Request $request): array
    {
        return Response::data($this->prospects->summaryBySector(self::shopIds($request)));
    }

    /** Comptes du vivier pour les secteurs demandés. */
    public function prospects(Request $request): array
    {
        return Response::data($this->prospects->listBySectors(
            AuthContext::current(),
            self::sectorIds($request),
            self::shopIds($request)
        ));
    }

    /**
     * Comptes distincts sur les secteurs demandés.
     *
     * Séparé de la liste parce que celle-ci est bornée : le panneau en montre
     * deux cents, le réseau en compte neuf cents, et compter les lignes reçues
     * annoncerait deux cents comptes à qui va en démarcher neuf cents.
     */
    public function prospectCount(Request $request): array
    {
        return Response::data($this->prospects->countBySectors(
            AuthContext::current(),
            self::sectorIds($request),
            self::shopIds($request)
        ));
    }

    /**
     * Boutiques de la campagne, quand elle en vise.
     *
     * Vide pour une campagne réseau, et c'est la bonne valeur : elle ne
     * restreint rien. Le périmètre de l'appelant, lui, s'applique de toute
     * façon plus loin — les deux filtres ne disent pas la même chose et ne se
     * remplacent pas.
     *
     * @return list<int>
     */
    private static function shopIds(Request $request): array
    {
        $raw = $request->queryString('shop_ids') ?? '';

        return array_values(array_filter(
            array_map('intval', explode(',', $raw)),
            static fn (int $v): bool => $v > 0
        ));
    }

    /** @return list<int> */
    private static function sectorIds(Request $request): array
    {
        $raw = $request->queryString('sector_ids') ?? '';

        return array_values(array_filter(
            array_map('intval', explode(',', $raw)),
            static fn (int $v): bool => $v > 0
        ));
    }

    /**
     * Import du vivier B2B.
     *
     * Le fichier est découpé côté client : le serveur reçoit des lignes déjà
     * structurées. Il n'a pas à connaître les séparateurs, les encodages ni les
     * en-têtes d'un CSV, et l'utilisateur voit son fichier interprété avant de
     * l'envoyer plutôt qu'après.
     */
    public function importProspects(Request $request): array
    {
        $rows = $request->input('rows');
        if (!is_array($rows) || $rows === []) {
            return Response::error('Aucune ligne à importer.', 422);
        }

        if (count($rows) > 5000) {
            return Response::error('Import limité à 5 000 lignes par envoi.', 422);
        }

        $brandId = $request->input('brand_id');
        $auth    = AuthContext::current();

        if (!$auth->isBrandAdmin()) {
            return Response::error('Le vivier B2B est géré au niveau du réseau.', 403);
        }

        $source = $request->input('source');

        return Response::data($this->prospects->import(
            $auth,
            is_numeric($brandId) ? (int) $brandId : $this->defaultBrandId(),
            array_values($rows),
            is_string($source) && $source !== '' ? $source : null
        ));
    }

    /** Crée les leads d'une campagne à partir du vivier. */
    public function generate(Request $request): array
    {
        $campaignId = $request->intParam('id');
        if ($campaignId === null) {
            return Response::error('Identifiant de campagne invalide.');
        }

        return Response::data($this->prospects->generateLeads(AuthContext::current(), $campaignId));
    }

    /** Marque par défaut : l'unique marque active, sinon on refuse de deviner. */
    private function defaultBrandId(): int
    {
        $brands = \Marketing\Support\Database::connection()
            ->query('SELECT id FROM mar_brand WHERE is_active = 1')
            ->fetchAll(\PDO::FETCH_COLUMN);

        if (count($brands) !== 1) {
            throw new \RuntimeException(
                'Plusieurs marques actives : précisez brand_id pour importer le vivier.'
            );
        }

        return (int) $brands[0];
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
