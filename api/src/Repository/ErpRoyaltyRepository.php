<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\ErpClient;
use Marketing\Support\Scope;
use RuntimeException;

/**
 * Redevances facturées par l'ERP, lues par son API.
 *
 * Ces factures existent déjà. Les ressaisir dans le module, ou les recalculer à
 * partir d'un taux et d'un CA tenus à part, produirait un deuxième chiffre pour
 * le même fait — et le jour où les deux divergent, personne ne sait lequel est
 * le bon.
 *
 * Elles étaient lues en SQL dans `royalty_invoice`. Elles ne le sont plus :
 * `GET /api/v1/admin/royalties/invoices` les rend, et le standard interdit à un
 * module de lire la base d'un autre. Le changement n'est pas que formel — le
 * paramètre `period` de l'API désigne la période **couverte**, là où la table
 * n'offrait qu'une date d'émission tombant le mois suivant. On demandait avril
 * en cherchant mai ; on demande avril.
 *
 * Ce que le module ne connaît toujours pas, c'est la forme des réponses : le
 * swagger de l'ERP documente les chemins et laisse les corps à « The data ».
 * Les clés sont donc reconnues, pas supposées, et ce qui ne l'est pas est
 * affiché avec ce qui a été reçu. Un nom deviné juste aujourd'hui devient un
 * montant faux en silence après une mise à jour de l'ERP.
 */
final class ErpRoyaltyRepository
{
    /**
     * Le chemin des factures, configurable — une installation peut l'avoir monté
     * ailleurs, et l'ERP en expose deux familles :
     *
     * — `/api/v1/panel/royalties/invoices`, celle qu'on utilise, servie par
     *   `Panel/royaltyShopRoutes.php` ;
     * — `/api/v1/admin/royalties/invoices`, la vue franchiseur, seule à porter
     *   un contrat documenté (`id_shop`, `status`, `period`).
     *
     * Le nom du fichier de routes laisse penser que la première est cadrée sur
     * une boutique. Si c'est le cas, il faut un appel par magasin :
     * `MAR_ERP_ROYALTY_SHOP_PARAM` porte alors le nom du paramètre, et le module
     * boucle. Sans lui, il appelle une fois. On ne devine pas ce nom — on le
     * déclare quand on le connaît.
     */
    private const INVOICES_PATH = '/api/v1/panel/royalties/invoices';

    /**
     * Clés cherchées dans une facture. L'ordre compte : le premier trouvé gagne.
     *
     * @var array<string, list<string>>
     */
    private const INVOICE_KEYS = [
        'id'          => ['id', 'invoiceId', 'id_invoice', 'royalty_invoice_id'],
        'shop'        => ['id_shop', 'shopId', 'shop_id', 'idShop'],
        'number'      => ['number', 'invoice_number', 'invoiceNumber', 'reference', 'symbol'],
        'date'        => ['issued_at', 'issuedAt', 'invoice_date', 'invoiceDate', 'date', 'created_at'],
        'period'      => ['period', 'month', 'period_month', 'periodMonth'],
        'period_from' => ['period_from', 'periodFrom', 'date_from', 'from'],
        'period_to'   => ['period_to', 'periodTo', 'date_to', 'to'],
        'total'       => ['total_net', 'totalNet', 'net_amount', 'netAmount', 'total', 'amount'],
        'status'      => ['status', 'state'],
        'lines'       => ['lines', 'items', 'positions', 'invoice_lines', 'invoiceLines', 'details'],
    ];

    /**
     * Clés cherchées dans une ligne de facture.
     *
     * `line_label` porte la nature de la redevance et `net_amount` le montant
     * dû — les deux seuls points établis avec certitude, parce qu'ils ont été
     * demandés puis confirmés.
     *
     * @var array<string, list<string>>
     */
    private const LINE_KEYS = [
        'label'  => ['line_label', 'lineLabel', 'label', 'name', 'description', 'designation'],
        'amount' => ['net_amount', 'netAmount', 'amount', 'total_net', 'value'],
        'rate'   => ['rate', 'rate_pct', 'ratePct', 'percent', 'percentage'],
        'base'   => ['base_amount', 'baseAmount', 'base', 'turnover', 'revenue'],
    ];

    /**
     * Ce qu'il faut au minimum pour écrire une entrée honnête : à qui, combien.
     * Sans l'un des deux, mieux vaut ne rien importer qu'importer à peu près.
     */
    private const INVOICE_REQUIRED = ['id', 'shop'];
    private const LINE_REQUIRED    = ['amount'];

    /**
     * Reconnaissance de la nature d'une ligne, par son libellé.
     *
     * Volontairement étroite. Un mot vague — « redevance », « royalties »,
     * « service » — s'applique aux trois natures : le retenir ferait classer
     * « Redevance » tout court en redevance de marque, et personne ne verrait
     * jamais l'erreur, parce qu'une ligne mal classée s'écrit aussi bien qu'une
     * ligne bien classée. Ce qui n'est pas reconnu est compté, affiché avec son
     * libellé exact, et non importé : une nature manquante se corrige, une
     * nature fausse se découvre au contrôle fiscal.
     *
     * @var array<string, list<string>>
     */
    private const KIND_HINTS = [
        'MARKETING'  => ['marketing', 'mkt', 'communication', 'publicit'],
        'ASSISTANCE' => ['assistance', 'assist', 'support'],
        'MARQUE'     => ['marque', 'brand', 'enseigne', 'licence'],
    ];

    /** Inventaire de la dernière lecture, pour le diagnostic de l'écran. */
    private array $inventory = [];

    public function __construct(private readonly ErpClient $erp = new ErpClient())
    {
    }

    /**
     * Ce que l'ERP a facturé pour ce mois, et comment le module le comprend.
     *
     * Ne lève pas : « l'adresse de l'ERP n'est pas renseignée » et « la clé du
     * montant n'a pas été reconnue » sont des réponses utiles, pas des erreurs
     * de l'appelant. L'écran les affiche telles quelles.
     *
     * @return array{available:bool, reason:?string, mapping:array<string,mixed>,
     *               inventory:array<string,mixed>, invoices:list<array<string,mixed>>}
     */
    public function preview(AuthContext $auth, string $month): array
    {
        try {
            $lecture = $this->read($auth, $month);
        } catch (RuntimeException $echec) {
            return [
                'available' => false,
                'reason'    => $echec->getMessage(),
                'mapping'   => [],
                'inventory' => $this->inventory,
                'invoices'  => [],
            ];
        }

        return [
            'available' => true,
            'reason'    => null,
            'mapping'   => $lecture['mapping'],
            'inventory' => $this->inventory,
            'invoices'  => $lecture['invoices'],
        ];
    }

    /**
     * Écrit au grand livre les redevances facturées par l'ERP pour ce mois.
     *
     * Chaque ligne de facture devient une entrée, avec la référence de la pièce :
     * c'est elle qui rend la reprise rejouable sans rien doubler — une facture
     * déjà reprise est reconnue et laissée telle quelle, y compris si elle a été
     * corrigée à la main depuis.
     *
     * @return array{created:int, skipped:int, unmatched_shop:int, unknown_kind:int,
     *               total_amount:float, lines:list<array<string,mixed>>}
     */
    public function import(AuthContext $auth, string $month): array
    {
        $lecture    = $this->read($auth, $month);
        $connection = Database::connection();

        $bilan = [
            'created' => 0, 'skipped' => 0, 'unmatched_shop' => 0, 'unknown_kind' => 0,
            'total_amount' => 0.0, 'lines' => [],
        ];

        $connection->beginTransaction();

        try {
            $dejaLa = $connection->prepare(
                'SELECT 1 FROM mar_fund_movement
                  WHERE document_ref = :piece AND source = :source AND shop_id = :shop'
            );

            $insertion = $connection->prepare(
                'INSERT INTO mar_fund_movement
                    (direction, shop_id, movement_date, period_from, period_to,
                     label, amount, base_amount, rate_pct, source, is_public,
                     supplier_name, document_ref, created_by)
                 VALUES
                    (\'IN\', :shop, :date, :depuis, :jusqu,
                     :label, :montant, :base, :taux, :source, :publique,
                     :fournisseur, :piece, :par)'
            );

            foreach ($lecture['invoices'] as $facture) {
                if ($facture['shop_id'] === null) {
                    $bilan['unmatched_shop'] += count($facture['lines']);

                    continue;
                }

                foreach ($facture['lines'] as $ligne) {
                    if ($ligne['kind'] === null) {
                        $bilan['unknown_kind']++;

                        continue;
                    }

                    $nature = RoyaltyRepository::KINDS[$ligne['kind']];

                    $dejaLa->execute([
                        'piece'  => $facture['document_ref'],
                        'source' => $nature['source'],
                        'shop'   => $facture['shop_id'],
                    ]);

                    if ($dejaLa->fetchColumn() !== false) {
                        $bilan['skipped']++;

                        continue;
                    }

                    $insertion->execute([
                        'shop'        => $facture['shop_id'],
                        'date'        => $facture['invoice_date'],
                        'depuis'      => $facture['period_from'],
                        'jusqu'       => $facture['period_to'],
                        'label'       => sprintf('%s — %s', $nature['label'], $facture['shop_name']),
                        'montant'     => $ligne['amount'],
                        'base'        => $ligne['base'],
                        'taux'        => $ligne['rate'],
                        'source'      => $nature['source'],
                        'publique'    => $nature['public'] ? 1 : 0,
                        'fournisseur' => $facture['shop_name'],
                        'piece'       => $facture['document_ref'],
                        'par'         => $auth->userId,
                    ]);

                    $bilan['created']++;
                    $bilan['total_amount'] += $ligne['amount'];
                    $bilan['lines'][] = [
                        'shop_name'    => $facture['shop_name'],
                        'kind'         => $ligne['kind'],
                        'amount'       => $ligne['amount'],
                        'document_ref' => $facture['document_ref'],
                    ];
                }
            }

            $connection->commit();
        } catch (\Throwable $echec) {
            $connection->rollBack();

            throw $echec;
        }

        $bilan['total_amount'] = round($bilan['total_amount'], 2);

        return $bilan;
    }

    /**
     * Lecture des factures du mois, boutiques rapprochées et natures reconnues.
     *
     * @return array{mapping:array<string,mixed>, invoices:list<array<string,mixed>>}
     */
    private function read(AuthContext $auth, string $month): array
    {
        $mois = substr(trim($month), 0, 7);
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $mois) !== 1) {
            throw new RuntimeException('Mois invalide : format attendu AAAA-MM.');
        }

        if (!ErpClient::isConfigured()) {
            throw new RuntimeException(ErpClient::missingConfiguration());
        }

        $premier = $mois . '-01';
        $dernier = (new \DateTimeImmutable($premier))->modify('last day of this month')->format('Y-m-d');

        // Rapprochement ERP → module par `erp_shop_id`, la référence externe que
        // `mar_shop` porte déjà. Une boutique non rapprochée n'est pas importée
        // en silence : le bilan la compte.
        $boutiques = [];
        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'id');
        $lien = Database::connection()->prepare(sprintf(
            'SELECT erp_shop_id, id, name FROM mar_shop WHERE erp_shop_id IS NOT NULL AND %s',
            $scopeSql
        ));
        $lien->execute($bindings);
        foreach ($lien->fetchAll() as $shop) {
            $boutiques[(string) $shop['erp_shop_id']] = ['id' => (int) $shop['id'], 'name' => $shop['name']];
        }

        $chemin = (string) (\Marketing\Support\Env::get('MAR_ERP_ROYALTY_INVOICES_PATH', self::INVOICES_PATH)
            ?: self::INVOICES_PATH);
        $paramBoutique = trim((string) (\Marketing\Support\Env::get('MAR_ERP_ROYALTY_SHOP_PARAM', '') ?? ''));

        // `period` désigne la période couverte, pas la date d'émission : c'est
        // l'API qui porte la distinction, et elle nous épargne le décalage d'un
        // mois qu'il fallait appliquer en lisant la table.
        $factures = [];

        if ($paramBoutique === '') {
            $factures = ErpClient::rows(
                $this->erp->get($chemin, ['period' => $mois]),
                ['invoices', 'items', 'rows']
            );
        } else {
            // Un appel par boutique quand l'endpoint est cadré sur une seule.
            // L'échec d'un magasin n'emporte pas les autres : une boutique qui
            // n'a pas de facture ce mois-là ne doit pas priver le réseau des
            // siennes.
            foreach ($boutiques as $erpShopId => $boutique) {
                try {
                    $factures = array_merge($factures, ErpClient::rows(
                        $this->erp->get($chemin, ['period' => $mois, $paramBoutique => $erpShopId]),
                        ['invoices', 'items', 'rows']
                    ));
                } catch (RuntimeException $echec) {
                    $this->inventory['boutiques en échec'][$boutique['name']] = $echec->getMessage();
                }
            }
        }

        $mapFacture = $this->resolve($factures[0] ?? [], self::INVOICE_KEYS, self::INVOICE_REQUIRED, 'facture');

        $resultat = [];
        $mapLigne = [];

        foreach ($factures as $facture) {
            $lignes = ErpClient::rows(
                isset($mapFacture['lines']) && is_array($facture[$mapFacture['lines']] ?? null)
                    ? ['data' => $facture[$mapFacture['lines']]]
                    : [],
                []
            );

            if ($lignes !== [] && $mapLigne === []) {
                $mapLigne = $this->resolve($lignes[0], self::LINE_KEYS, self::LINE_REQUIRED, 'ligne');
            }

            $erpShop   = (string) ($facture[$mapFacture['shop']] ?? '');
            $rapproche = $boutiques[$erpShop] ?? null;

            $resultat[] = [
                'erp_id'       => (string) ($facture[$mapFacture['id']] ?? ''),
                'shop_id'      => $rapproche['id'] ?? null,
                'shop_name'    => $rapproche['name'] ?? sprintf('Boutique ERP %s', $erpShop),
                'erp_shop_id'  => $erpShop,
                'document_ref' => (string) ($this->lire($facture, $mapFacture, 'number')
                    ?? sprintf('royalty-%s', $facture[$mapFacture['id']] ?? '')),
                'invoice_date' => substr((string) ($this->lire($facture, $mapFacture, 'date') ?? $dernier), 0, 10),
                'period_from'  => substr((string) ($this->lire($facture, $mapFacture, 'period_from') ?? $premier), 0, 10),
                'period_to'    => substr((string) ($this->lire($facture, $mapFacture, 'period_to') ?? $dernier), 0, 10),
                'revenue'      => null,
                'total'        => $this->nombre($this->lire($facture, $mapFacture, 'total')),
                'status'       => $this->lire($facture, $mapFacture, 'status'),
                'lines'        => $this->lignes($lignes, $mapLigne),
            ];
        }

        return ['mapping' => ['invoice' => $mapFacture, 'line' => $mapLigne], 'invoices' => $resultat];
    }

    /**
     * @param  list<array<string,mixed>> $lignes
     * @param  array<string,string>      $map
     * @return list<array<string,mixed>>
     */
    private function lignes(array $lignes, array $map): array
    {
        if ($map === []) {
            return [];
        }

        $sorties = [];
        foreach ($lignes as $ligne) {
            $libelle  = $this->lire($ligne, $map, 'label');
            $montant  = round((float) $this->nombre($this->lire($ligne, $map, 'amount')), 2);
            $taux     = $this->nombre($this->lire($ligne, $map, 'rate'));
            $assiette = $this->nombre($this->lire($ligne, $map, 'base'));

            // L'assiette déduite quand l'ERP ne la rend pas : un montant et un
            // pourcentage suffisent à la retrouver, c'est la définition même
            // d'un pourcentage. Elle est marquée comme déduite — un chiffre
            // calculé ne se présente pas comme un chiffre lu.
            $deduite = false;
            if ($assiette === null && $taux !== null && $taux > 0) {
                $assiette = round($montant * 100 / $taux, 2);
                $deduite  = true;
            }

            $sorties[] = [
                'label'        => $libelle === null ? null : (string) $libelle,
                'kind'         => $this->recognise((string) ($libelle ?? '')),
                'rate'         => $taux,
                'base'         => $assiette,
                'base_derived' => $deduite,
                'amount'       => $montant,
            ];
        }

        return $sorties;
    }

    /**
     * Nature d'une ligne, d'après son libellé — ou rien.
     *
     * Publique et statique parce qu'elle se vérifie sans réseau : c'est une
     * règle de lecture, et l'ERP n'a pas à être imité pour l'éprouver.
     */
    public static function kindFromLabel(string $texte): ?string
    {
        $normalise = mb_strtolower(trim($texte));
        if ($normalise === '') {
            return null;
        }

        foreach (self::KIND_HINTS as $kind => $indices) {
            foreach ($indices as $indice) {
                if (str_contains($normalise, $indice)) {
                    return $kind;
                }
            }
        }

        return null;
    }

    private function recognise(string $texte): ?string
    {
        return self::kindFromLabel($texte);
    }

    /**
     * Correspondance notion → clé réelle, découverte dans la réponse.
     *
     * Ce qui n'a pas été reconnu est conservé avec les clés reçues : sans cet
     * inventaire, une notion absente se traduit par un champ vide, et rien ne
     * dit si l'ERP ne la rend pas ou s'il la nomme autrement.
     *
     * @param  array<string,mixed>         $echantillon
     * @param  array<string, list<string>> $candidates
     * @param  list<string>                $required
     * @return array<string, string>
     */
    private function resolve(array $echantillon, array $candidates, array $required, string $quoi): array
    {
        $presentes = array_keys($echantillon);
        $minuscule = array_map('strtolower', array_map('strval', $presentes));

        if ($presentes === []) {
            $this->inventory[$quoi] = ['disponibles' => [], 'non reconnues' => array_keys($candidates)];

            // Pas de facture ce mois-ci : ce n'est pas une erreur, et un mois
            // sans redevance existe (réseau fermé, période non facturée).
            return [];
        }

        $trouvees = [];
        foreach ($candidates as $notion => $noms) {
            foreach ($noms as $nom) {
                $rang = array_search(strtolower($nom), $minuscule, true);
                if ($rang !== false) {
                    $trouvees[$notion] = (string) $presentes[$rang];
                    break;
                }
            }
        }

        $this->inventory[$quoi] = [
            'non reconnues' => array_values(array_diff(array_keys($candidates), array_keys($trouvees))),
            'disponibles'   => array_map('strval', $presentes),
        ];

        $manquantes = array_diff($required, array_keys($trouvees));
        if ($manquantes !== []) {
            throw new RuntimeException(sprintf(
                'Clés indispensables absentes de la %s rendue par l\'ERP : %s. Clés reçues : %s.',
                $quoi,
                implode(', ', $manquantes),
                implode(', ', array_map('strval', $presentes))
            ));
        }

        return $trouvees;
    }

    /**
     * @param array<string,mixed>  $source
     * @param array<string,string> $map
     */
    private function lire(array $source, array $map, string $notion): mixed
    {
        return isset($map[$notion]) ? ($source[$map[$notion]] ?? null) : null;
    }

    /** Un nombre, quelle que soit la façon dont l'ERP l'écrit — ou rien. */
    private function nombre(mixed $valeur): ?float
    {
        if ($valeur === null || $valeur === '' || is_array($valeur)) {
            return null;
        }

        // Les montants arrivent parfois en chaîne, avec une virgule ou une
        // espace insécable de milliers : les refuser ferait perdre la facture
        // entière pour une question de typographie.
        $texte = str_replace([' ', ' ', ','], ['', '', '.'], (string) $valeur);

        return is_numeric($texte) ? (float) $texte : null;
    }
}
