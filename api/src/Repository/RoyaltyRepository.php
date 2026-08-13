<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;

/**
 * Redevances : trois natures, un taux par magasin, un CA net par mois.
 *
 * Ce qui alimente le fonds n'est pas saisi ligne à ligne. C'est un pourcentage
 * du chiffre d'affaires net de chaque magasin, décliné en trois — assistance,
 * marque, marketing. Vingt magasins font soixante écritures par mois : elles se
 * calculent, elles ne se tapent pas.
 *
 * Deux principes tiennent ce dépôt :
 *
 * — le taux a une histoire. Le renégocier ferme la ligne précédente et en ouvre
 *   une nouvelle au premier du mois choisi ; les mois déjà facturés continuent
 *   de lire le taux qui était le leur.
 * — l'écriture engendrée est autoportante. Elle garde la base et le taux qui
 *   l'ont produite, si bien qu'un franchisé qui conteste a de quoi recalculer,
 *   même si le contrat a changé depuis.
 */
final class RoyaltyRepository
{
    /**
     * Les trois redevances, et ce qui les distingue une fois écrites.
     *
     * `public` est la seule différence de nature entre elles : le fonds
     * marketing se rend des comptes au réseau qui l'alimente, alors que
     * l'assistance et la marque sont les revenus de la marque — pas l'affaire
     * des franchisés les uns des autres.
     */
    public const KINDS = [
        'MARKETING'  => ['source' => 'ROYALTY_MARKETING',  'label' => 'Redevance marketing',    'public' => true],
        'ASSISTANCE' => ['source' => 'ROYALTY_ASSISTANCE', 'label' => "Redevance d'assistance", 'public' => false],
        'MARQUE'     => ['source' => 'ROYALTY_MARQUE',     'label' => 'Redevance de marque',    'public' => false],
    ];

    /**
     * Le tableau de bord d'un mois : par magasin, son CA net, ses trois taux, et
     * ce qui a déjà été écrit.
     *
     * Rendre l'existant compte autant que rendre les taux : sans lui, l'écran ne
     * sait pas distinguer « pas encore facturé » de « facturé à zéro », et le
     * bouton de génération devient un pari.
     *
     * @return array{month:string, shops:list<array<string,mixed>>}
     */
    public function __construct(
        private readonly ErpRoyaltyRepository $erp = new ErpRoyaltyRepository(),
    ) {
    }

    public function board(AuthContext $auth, string $month): array
    {
        $premier = $this->firstDay($month);
        $dernier = $this->lastDay($month);

        [$scopeSql, $bindings] = Scope::shopFilter($auth, 's.id');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT s.id, s.name, s.city, r.revenue_amount
               FROM mar_shop s
               LEFT JOIN mar_shop_revenue r ON r.shop_id = s.id AND r.period_month = :mois
              WHERE %s
              ORDER BY s.name',
            $scopeSql
        ));
        $statement->execute($bindings + ['mois' => $premier]);

        $shops = [];
        foreach ($statement->fetchAll() as $row) {
            $shops[(int) $row['id']] = [
                'shop_id'        => (int) $row['id'],
                'shop_name'      => $row['name'],
                'city'           => $row['city'],
                // NULL et 0 ne disent pas la même chose : « pas encore déclaré »
                // n'est pas « fermé tout le mois ».
                'revenue_amount' => $row['revenue_amount'] !== null ? (float) $row['revenue_amount'] : null,
                'rates'          => [],
                'movements'      => [],
                'erp'            => null,
            ];
        }

        if ($shops === []) {
            return ['month' => substr($premier, 0, 7), 'shops' => [], 'erp' => null];
        }

        foreach ($this->effectiveRates(array_keys($shops), $premier) as $shopId => $rates) {
            $shops[$shopId]['rates'] = $rates;
        }

        // Ce qui est déjà au grand livre pour ce mois, redevance par redevance.
        // Paramètres positionnels de bout en bout : PDO refuse un mélange des
        // deux nommages dans une même requête.
        $parSource = [];
        foreach (self::KINDS as $kind => $nature) {
            $parSource[$nature['source']] = $kind;
        }

        $ecrites = Database::connection()->prepare(sprintf(
            'SELECT id, shop_id, source, amount, base_amount, rate_pct
               FROM mar_fund_movement
              WHERE period_from = ? AND source IN (%s)',
            implode(', ', array_fill(0, count($parSource), '?'))
        ));
        $ecrites->execute([$premier, ...array_keys($parSource)]);

        foreach ($ecrites->fetchAll() as $ligne) {
            $shopId = (int) $ligne['shop_id'];
            if (!isset($shops[$shopId])) {
                continue;
            }

            $kind = $parSource[$ligne['source']];
            $shops[$shopId]['movements'][$kind] = [
                'id'          => (int) $ligne['id'],
                'amount'      => (float) $ligne['amount'],
                'base_amount' => $ligne['base_amount'] !== null ? (float) $ligne['base_amount'] : null,
                'rate_pct'    => $ligne['rate_pct'] !== null ? (float) $ligne['rate_pct'] : null,
            ];
        }

        unset($dernier);

        // Ce que l'ERP a facturé vient s'asseoir dans le même tableau, sur la
        // ligne de la boutique concernée. Le tenir dans un bloc à part obligeait
        // à comparer deux listes de l'œil pour répondre à « ce magasin est-il à
        // jour ? » — c'est justement la question que le tableau doit trancher.
        $erp = $this->erp->preview($auth, $month);

        // Les libellés que la lecture n'a pas su classer, relevés sur toutes les
        // factures — y compris celles dont la boutique n'est pas rapprochée.
        // C'est le seul endroit d'où l'on peut apprendre comment l'ERP nomme
        // réellement ses redevances : les deviner est ce qui s'est déjà mal
        // passé une fois.
        $libellesInconnus = [];
        foreach ($erp['invoices'] as $facture) {
            foreach ($facture['lines'] as $ligne) {
                if ($ligne['kind'] === null && $ligne['label'] !== null) {
                    $libellesInconnus[(string) $ligne['label']] = true;
                }
            }
        }

        foreach ($erp['invoices'] as $facture) {
            if ($facture['shop_id'] === null || !isset($shops[$facture['shop_id']])) {
                continue;
            }

            $lignes    = [];
            $inconnues = 0;
            foreach ($facture['lines'] as $ligne) {
                if ($ligne['kind'] === null) {
                    $inconnues++;

                    continue;
                }

                $lignes[$ligne['kind']] = [
                    'amount'       => $ligne['amount'],
                    'rate'         => $ligne['rate'],
                    'base'         => $ligne['base'],
                    // Vrai quand l'assiette a été retrouvée à partir du montant
                    // et du taux, faute d'être stockée par l'ERP.
                    'base_derived' => $ligne['base_derived'],
                    'label'        => $ligne['label'],
                ];
            }

            $shops[$facture['shop_id']]['erp'] = [
                'document_ref'   => $facture['document_ref'],
                // Le CA du mois : celui de la facture si l'ERP le porte, sinon
                // l'assiette des lignes — les trois redevances portent sur le
                // même chiffre d'affaires. Si elles divergent, on n'en retient
                // aucun : une colonne « CA net » qui affiche l'un des trois sans
                // dire lequel vaut moins qu'une colonne vide.
                'revenue'        => $facture['revenue'] ?? $this->assietteCommune($lignes),
                'total'          => $facture['total'],
                'lines'          => $lignes,
                'unknown_lines'  => $inconnues,
            ];
        }

        return [
            'month' => substr($premier, 0, 7),
            'shops' => array_values($shops),
            // L'état de la lecture ERP voyage avec le tableau : « aucune facture
            // ce mois-ci » et « la table n'a pas pu être lue » ne se corrigent
            // pas de la même façon, et un tableau vide ne dit ni l'un ni l'autre.
            'erp'   => [
                'available' => $erp['available'],
                'reason'    => $erp['reason'],
                'invoices'  => count($erp['invoices']),
                'inventory' => $erp['inventory'],
                // Affichés tels quels : c'est ainsi qu'on apprend comment l'ERP
                // nomme ses redevances, sans avoir à interroger la base.
                'unknown_labels' => array_keys($libellesInconnus),
            ],
        ];
    }

    /**
     * L'assiette partagée par les lignes d'une facture, ou rien.
     *
     * Les trois redevances portent sur le même chiffre d'affaires : quand elles
     * s'accordent, ce chiffre est le CA du mois. Quand elles divergent, il n'y a
     * pas de « le » CA — en afficher un sans dire lequel serait pire que de
     * n'en afficher aucun.
     *
     * @param array<string, array{base:?float}> $lignes
     */
    private function assietteCommune(array $lignes): ?float
    {
        $assiettes = [];
        foreach ($lignes as $ligne) {
            if ($ligne['base'] !== null) {
                $assiettes[(string) round($ligne['base'], 2)] = round($ligne['base'], 2);
            }
        }

        return count($assiettes) === 1 ? array_values($assiettes)[0] : null;
    }

    /**
     * Enregistre les taux à effet du premier du mois affiché.
     *
     * Un taux inchangé n'écrit rien : sans cette vérification, ouvrir l'écran et
     * cliquer « Enregistrer » créerait une version de plus à chaque passage, et
     * l'historique des taux — qui sert justement à savoir quand le contrat a
     * bougé — deviendrait illisible.
     *
     * @param  list<array{shop_id:int|string, kind:string, rate_pct:mixed}> $rates
     * @return array{changed:int, unchanged:int}
     */
    public function saveRates(AuthContext $auth, string $month, array $rates): array
    {
        $premier = $this->firstDay($month);
        $veille  = (new \DateTimeImmutable($premier))->modify('-1 day')->format('Y-m-d');

        $connection = Database::connection();
        $changed    = 0;
        $unchanged  = 0;

        $connection->beginTransaction();

        try {
            foreach ($rates as $entree) {
                $shopId = (int) ($entree['shop_id'] ?? 0);
                $kind   = (string) ($entree['kind'] ?? '');

                if (!isset(self::KINDS[$kind])) {
                    throw new RuntimeException(sprintf('Nature de redevance inconnue : %s.', $kind));
                }

                if (!Scope::allowsShop($auth, $shopId)) {
                    throw new RuntimeException('Boutique hors de votre périmètre.');
                }

                $taux = $entree['rate_pct'] ?? null;
                if (!is_numeric($taux) || (float) $taux < 0 || (float) $taux > 100) {
                    throw new RuntimeException('Un taux de redevance va de 0 à 100 %.');
                }

                $taux    = round((float) $taux, 2);
                $courant = $this->effectiveRates([$shopId], $premier)[$shopId][$kind] ?? null;

                if ($courant !== null && abs($courant['rate_pct'] - $taux) < 0.005) {
                    $unchanged++;

                    continue;
                }

                $brandId = $connection->prepare('SELECT brand_id FROM mar_shop WHERE id = :id');
                $brandId->execute(['id' => $shopId]);
                $brand = $brandId->fetchColumn();

                if ($brand === false) {
                    throw new RuntimeException('Boutique introuvable.');
                }

                // Une révision au même premier du mois corrige la version en
                // place : deux lignes ouvertes le même jour rendraient la
                // facture dépendante de l'ordre de lecture.
                $memeJour = $connection->prepare(
                    'UPDATE mar_royalty_rate SET rate_pct = :taux
                      WHERE shop_id = :shop AND kind = :kind AND valid_from = :depuis'
                );
                $memeJour->execute([
                    'taux' => $taux, 'shop' => $shopId, 'kind' => $kind, 'depuis' => $premier,
                ]);

                if ($memeJour->rowCount() === 0) {
                    // La version précédente se ferme la veille : sans cela, deux
                    // taux couvriraient le même mois.
                    $fermeture = $connection->prepare(
                        'UPDATE mar_royalty_rate SET valid_to = :veille
                          WHERE shop_id = :shop AND kind = :kind
                            AND valid_from < :depuis AND valid_to IS NULL'
                    );
                    $fermeture->execute([
                        'veille' => $veille, 'shop' => $shopId, 'kind' => $kind, 'depuis' => $premier,
                    ]);

                    $insertion = $connection->prepare(
                        'INSERT INTO mar_royalty_rate
                            (brand_id, shop_id, kind, rate_pct, valid_from, created_by)
                         VALUES (:brand, :shop, :kind, :taux, :depuis, :par)'
                    );
                    $insertion->execute([
                        'brand'  => (int) $brand,
                        'shop'   => $shopId,
                        'kind'   => $kind,
                        'taux'   => $taux,
                        'depuis' => $premier,
                        'par'    => $auth->userId,
                    ]);
                }

                $changed++;
            }

            $connection->commit();
        } catch (\Throwable $echec) {
            $connection->rollBack();

            throw $echec;
        }

        return ['changed' => $changed, 'unchanged' => $unchanged];
    }

    /**
     * Enregistre le chiffre d'affaires net du mois, magasin par magasin.
     *
     * Une valeur vide efface la déclaration au lieu de la mettre à zéro : « pas
     * encore reçu » et « zéro euro » appellent deux gestes différents, et le
     * second facturerait une redevance nulle qu'il faudrait ensuite expliquer.
     *
     * @param  list<array{shop_id:int|string, revenue_amount:mixed}> $revenues
     * @return array{saved:int, cleared:int}
     */
    public function saveRevenues(AuthContext $auth, string $month, array $revenues): array
    {
        $premier = $this->firstDay($month);

        $connection = Database::connection();
        $saved      = 0;
        $cleared    = 0;

        $connection->beginTransaction();

        try {
            foreach ($revenues as $entree) {
                $shopId = (int) ($entree['shop_id'] ?? 0);

                if (!Scope::allowsShop($auth, $shopId)) {
                    throw new RuntimeException('Boutique hors de votre périmètre.');
                }

                $montant = $entree['revenue_amount'] ?? null;

                if ($montant === null || $montant === '') {
                    $effacement = $connection->prepare(
                        'DELETE FROM mar_shop_revenue WHERE shop_id = :shop AND period_month = :mois'
                    );
                    $effacement->execute(['shop' => $shopId, 'mois' => $premier]);
                    $cleared++;

                    continue;
                }

                if (!is_numeric($montant) || (float) $montant < 0) {
                    throw new RuntimeException('Un chiffre d\'affaires ne peut pas être négatif.');
                }

                $ecriture = $connection->prepare(
                    'INSERT INTO mar_shop_revenue (shop_id, period_month, revenue_amount, created_by)
                     VALUES (:shop, :mois, :montant, :par)
                     ON DUPLICATE KEY UPDATE revenue_amount = VALUES(revenue_amount)'
                );
                $ecriture->execute([
                    'shop'    => $shopId,
                    'mois'    => $premier,
                    'montant' => round((float) $montant, 2),
                    'par'     => $auth->userId,
                ]);

                $saved++;
            }

            $connection->commit();
        } catch (\Throwable $echec) {
            $connection->rollBack();

            throw $echec;
        }

        return ['saved' => $saved, 'cleared' => $cleared];
    }

    /**
     * Écrit les redevances du mois au grand livre.
     *
     * Ne touche jamais à une ligne existante. Regénérer un mois déjà facturé
     * écraserait les corrections faites à la main — une remise accordée, un mois
     * partiel négocié — et personne ne saurait dire ce qui a disparu. Ce qui
     * existe est signalé, pas remplacé ; l'écran laisse corriger ou supprimer la
     * ligne, puis relancer.
     *
     * @param  list<string> $kinds Natures à écrire ; vide = les trois.
     * @return array{created:int, skipped:int, without_rate:int, without_revenue:int,
     *               total_amount:float, lines:list<array<string,mixed>>}
     */
    public function generate(AuthContext $auth, string $month, array $kinds = []): array
    {
        $premier = $this->firstDay($month);
        $dernier = $this->lastDay($month);

        $natures = $kinds === [] ? array_keys(self::KINDS) : $kinds;
        foreach ($natures as $kind) {
            if (!isset(self::KINDS[$kind])) {
                throw new RuntimeException(sprintf('Nature de redevance inconnue : %s.', $kind));
            }
        }

        $tableau = $this->board($auth, $month);
        $connection = Database::connection();

        $bilan = [
            'created' => 0, 'skipped' => 0, 'without_rate' => 0, 'without_revenue' => 0,
            // Combien viennent d'une facture ERP plutôt que d'un calcul local :
            // les deux origines n'appellent pas la même confiance, et le bilan
            // doit permettre de les distinguer sans rouvrir le grand livre.
            'from_erp' => 0,
            'total_amount' => 0.0, 'lines' => [],
        ];

        $connection->beginTransaction();

        try {
            $insertion = $connection->prepare(
                'INSERT INTO mar_fund_movement
                    (direction, shop_id, movement_date, period_from, period_to,
                     label, amount, base_amount, rate_pct, source, is_public,
                     document_ref, created_by)
                 VALUES
                    (\'IN\', :shop, :date, :depuis, :jusqu,
                     :label, :montant, :base, :taux, :source, :publique,
                     :piece, :par)'
            );

            // La pièce reconnaît une facture ERP déjà reprise, même si sa
            // période ne tombe pas exactement sur le mois affiché.
            $dejaReprise = $connection->prepare(
                'SELECT 1 FROM mar_fund_movement
                  WHERE document_ref = :piece AND source = :source AND shop_id = :shop'
            );

            foreach ($tableau['shops'] as $boutique) {
                foreach ($natures as $kind) {
                    // La facture de l'ERP fait foi quand elle existe : c'est le
                    // montant réellement dû, et le recalculer à partir d'un taux
                    // tenu à part donnerait un second chiffre pour le même fait.
                    $facturee = $boutique['erp']['lines'][$kind] ?? null;
                    $taux     = $facturee['rate'] ?? $boutique['rates'][$kind]['rate_pct'] ?? null;

                    if ($facturee === null && $taux === null) {
                        $bilan['without_rate']++;

                        continue;
                    }

                    if ($facturee === null && $boutique['revenue_amount'] === null) {
                        $bilan['without_revenue']++;

                        continue;
                    }

                    if (isset($boutique['movements'][$kind])) {
                        $bilan['skipped']++;

                        continue;
                    }

                    $piece = $facturee === null ? null : $boutique['erp']['document_ref'];

                    if ($piece !== null) {
                        $dejaReprise->execute([
                            'piece'  => $piece,
                            'source' => self::KINDS[$kind]['source'],
                            'shop'   => $boutique['shop_id'],
                        ]);

                        if ($dejaReprise->fetchColumn() !== false) {
                            $bilan['skipped']++;

                            continue;
                        }
                    }

                    $montant = $facturee !== null
                        ? $facturee['amount']
                        : round($boutique['revenue_amount'] * $taux / 100, 2);

                    $insertion->execute([
                        'piece'    => $piece,
                        'shop'     => $boutique['shop_id'],
                        // Facturée à la clôture du mois qu'elle couvre : la
                        // dater du premier ferait tomber la redevance de mars
                        // dans un solde de mars encore vide de son CA.
                        'date'     => $dernier,
                        'depuis'   => $premier,
                        'jusqu'    => $dernier,
                        'label'    => sprintf(
                            '%s — %s',
                            self::KINDS[$kind]['label'],
                            $boutique['shop_name']
                        ),
                        'montant'  => $montant,
                        // La base facturée, ou celle déclarée à défaut : c'est
                        // elle qui rend le montant recalculable des années plus
                        // tard, quand le contrat aura changé deux fois.
                        'base'     => $facturee['base'] ?? $boutique['revenue_amount'],
                        'taux'     => $taux,
                        'source'   => self::KINDS[$kind]['source'],
                        'publique' => self::KINDS[$kind]['public'] ? 1 : 0,
                        'par'      => $auth->userId,
                    ]);

                    $bilan['created']++;
                    $bilan['total_amount'] += $montant;
                    $bilan['from_erp']     += $facturee !== null ? 1 : 0;
                    $bilan['lines'][] = [
                        'shop_id'   => $boutique['shop_id'],
                        'shop_name' => $boutique['shop_name'],
                        'kind'      => $kind,
                        'amount'    => $montant,
                        'from_erp'  => $facturee !== null,
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
     * Taux en vigueur au premier du mois, par magasin et par nature.
     *
     * Un taux sans boutique est le taux par défaut de la marque : il s'applique
     * aux magasins qui n'ont pas le leur, ce qui évite d'écrire vingt fois la
     * même ligne pour un réseau qui n'a qu'une grille.
     *
     * @param  list<int> $shopIds
     * @return array<int, array<string, array{rate_pct:float, valid_from:string, from_default:bool}>>
     */
    private function effectiveRates(array $shopIds, string $premier): array
    {
        if ($shopIds === []) {
            return [];
        }

        $marques = Database::connection()->prepare(sprintf(
            'SELECT id, brand_id FROM mar_shop WHERE id IN (%s)',
            implode(', ', array_fill(0, count($shopIds), '?'))
        ));
        $marques->execute($shopIds);
        $brandOf = array_map('intval', $marques->fetchAll(PDO::FETCH_KEY_PAIR));

        // Deux noms pour la même date : les requêtes préparées ne sont pas
        // émulées ici, et PDO refuse alors de lier deux fois un même paramètre.
        $lecture = Database::connection()->prepare(
            'SELECT shop_id, brand_id, kind, rate_pct, valid_from
               FROM mar_royalty_rate
              WHERE valid_from <= :ouverture AND (valid_to IS NULL OR valid_to >= :cloture)
              ORDER BY valid_from'
        );
        $lecture->execute(['ouverture' => $premier, 'cloture' => $premier]);

        $parBoutique = [];
        $parMarque   = [];

        // Ordonné par date d'effet croissante : la dernière écrasement gagne,
        // donc c'est bien la version la plus récente qui reste.
        foreach ($lecture->fetchAll() as $ligne) {
            $valeur = [
                'rate_pct'     => (float) $ligne['rate_pct'],
                'valid_from'   => $ligne['valid_from'],
                'from_default' => $ligne['shop_id'] === null,
            ];

            if ($ligne['shop_id'] === null) {
                $parMarque[(int) $ligne['brand_id']][$ligne['kind']] = $valeur;
            } else {
                $parBoutique[(int) $ligne['shop_id']][$ligne['kind']] = $valeur;
            }
        }

        $resultat = [];
        foreach ($shopIds as $shopId) {
            $defaut = $parMarque[$brandOf[$shopId] ?? 0] ?? [];
            $propre = $parBoutique[$shopId] ?? [];

            $resultat[$shopId] = $propre + $defaut;
        }

        return $resultat;
    }

    /** Premier jour du mois, à partir de « AAAA-MM » ou d'une date complète. */
    private function firstDay(string $month): string
    {
        $mois = substr(trim($month), 0, 7);

        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $mois) !== 1) {
            throw new RuntimeException('Mois invalide : format attendu AAAA-MM.');
        }

        return $mois . '-01';
    }

    private function lastDay(string $month): string
    {
        return (new \DateTimeImmutable($this->firstDay($month)))
            ->modify('last day of this month')
            ->format('Y-m-d');
    }
}
