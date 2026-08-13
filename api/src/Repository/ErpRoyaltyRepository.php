<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Env;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;

/**
 * Redevances facturées par l'ERP : `royalty_invoice` et `royalty_invoice_line`.
 *
 * Ces factures existent déjà. Les ressaisir dans le module, ou les recalculer à
 * partir d'un taux et d'un CA tenus à part, produirait un deuxième chiffre pour
 * le même fait — et le jour où les deux divergent, personne ne sait lequel est
 * le bon. Le module lit donc ce que l'ERP a facturé, et rien d'autre.
 *
 * Il le lit sans jamais l'écrire : aucune requête d'ici ne modifie une table de
 * l'ERP. Les colonnes sont découvertes dans le schéma plutôt que codées en dur,
 * comme pour les autres reprises du module — un nom de colonne deviné juste
 * aujourd'hui devient un montant faux en silence après une mise à jour de
 * l'ERP. Ce qui n'est pas reconnu est dit, avec la liste de ce que la table
 * contient réellement.
 */
final class ErpRoyaltyRepository
{
    /**
     * L'en-tête de facture. Une notion par ligne, plusieurs noms possibles :
     * l'ordre compte, le premier trouvé gagne.
     *
     * @var array<string, list<string>>
     */
    private const INVOICE_COLUMNS = [
        'id'          => ['id', 'royalty_invoice_id', 'invoice_id'],
        // `shop_id` d'abord : la facture désigne `shops.id`, pas le magasin
        // franchisé. Si les deux colonnes coexistaient, l'ordre trancherait au
        // profit de la mauvaise.
        'shop'        => ['shop_id', 'id_shop', 'franchisee_shop_id', 'id_franchisee_shop', 'magasin_id'],
        'number'      => ['invoice_number', 'number', 'reference', 'ref', 'code', 'num'],
        'date'        => ['invoice_date', 'date', 'issued_at', 'billing_date', 'created_at'],
        'period_from' => ['period_from', 'period_start', 'date_from', 'start_date', 'period_month', 'month'],
        'period_to'   => ['period_to', 'period_end', 'date_to', 'end_date'],
        'revenue'     => ['net_revenue', 'revenue_net', 'ca_net', 'turnover', 'revenue_amount', 'base_amount'],
        'total'       => ['total_amount', 'amount_total', 'total_ht', 'total', 'amount'],
        'status'      => ['status', 'state', 'statut'],
    ];

    /** @var array<string, list<string>> */
    private const LINE_COLUMNS = [
        'invoice' => ['royalty_invoice_id', 'invoice_id', 'id_royalty_invoice', 'id_invoice', 'header_id'],
        // `line_label` porte la nature de la ligne : c'est lui qui distingue les
        // trois redevances, et il passe donc avant tout autre libellé.
        'label'   => ['line_label', 'label', 'designation', 'description', 'name', 'wording', 'libelle'],
        'kind'    => ['type', 'kind', 'royalty_type', 'category', 'code', 'nature'],
        'rate'    => ['rate_pct', 'rate', 'percent', 'percentage', 'pct', 'taux'],
        // Le chiffre d'affaires net est porté par la ligne, dans `net_amount` :
        // c'est l'assiette de la redevance, pas le montant dû.
        'base'    => ['net_amount', 'base_amount', 'base', 'net_revenue', 'revenue', 'ca_net', 'turnover'],
        'amount'  => ['amount', 'total_amount', 'amount_ht', 'line_total', 'total', 'montant'],
    ];

    /**
     * Ce qu'il faut au minimum pour écrire une entrée honnête : à qui, quand,
     * combien. Sans l'une des trois, mieux vaut ne rien importer que d'importer
     * approximativement.
     */
    private const INVOICE_REQUIRED = ['id', 'shop'];
    private const LINE_REQUIRED    = ['invoice', 'amount'];

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
     * L'ordre compte : « redevance marketing » contient aussi « marque » dans
     * certaines formulations, et le premier trouvé gagne.
     *
     * @var array<string, list<string>>
     */
    private const KIND_HINTS = [
        'MARKETING'  => ['marketing', 'mkt', 'communication', 'publicit'],
        'ASSISTANCE' => ['assistance', 'assist', 'support'],
        'MARQUE'     => ['marque', 'brand', 'enseigne', 'licence'],
    ];

    /** Inventaire de la dernière résolution, pour le diagnostic de l'écran. */
    private array $inventory = [];

    /**
     * Ce que l'ERP contient pour ce mois, et comment le module le comprend.
     *
     * Ce diagnostic n'est pas un luxe : les deux tables vivent dans l'ERP, dont
     * ce dépôt ne connaît pas le schéma. Il vaut mieux montrer ce qui a été
     * reconnu — et ce qui ne l'a pas été — que de laisser un import produire des
     * montants dont personne ne peut dire d'où ils sortent.
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
     * Chaque ligne de facture devient une entrée, avec la référence de la pièce
     * : c'est elle qui rend l'import rejouable sans doubler quoi que ce soit —
     * une facture déjà reprise est reconnue et laissée telle quelle, y compris
     * si elle a été corrigée à la main depuis.
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
                        'shop_name' => $facture['shop_name'],
                        'kind'      => $ligne['kind'],
                        'amount'    => $ligne['amount'],
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
     * Lecture brute des factures du mois, boutiques rapprochées et natures
     * reconnues.
     *
     * @return array{mapping:array<string,mixed>, invoices:list<array<string,mixed>>}
     */
    private function read(AuthContext $auth, string $month): array
    {
        $mois = substr(trim($month), 0, 7);
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $mois) !== 1) {
            throw new RuntimeException('Mois invalide : format attendu AAAA-MM.');
        }

        $premier = $mois . '-01';
        $dernier = (new \DateTimeImmutable($premier))->modify('last day of this month')->format('Y-m-d');

        [$factureSchema, $factureTable] = $this->source('MAR_ERP_ROYALTY_INVOICE_TABLE', 'royalty_invoice');
        [$ligneSchema, $ligneTable]     = $this->source('MAR_ERP_ROYALTY_LINE_TABLE', 'royalty_invoice_line');

        $facture = $this->resolve($factureSchema, $factureTable, self::INVOICE_COLUMNS, self::INVOICE_REQUIRED);
        $ligne   = $this->resolve($ligneSchema, $ligneTable, self::LINE_COLUMNS, self::LINE_REQUIRED);

        // La période de la facture : une borne explicite si l'ERP en tient une,
        // sa date d'émission sinon. Sans l'une ni l'autre, on ne sait pas quel
        // mois la facture couvre, et importer « tout » chaque fois doublerait
        // le grand livre au deuxième passage.
        $colonneMois = $facture['period_from'] ?? $facture['date'] ?? null;
        if ($colonneMois === null) {
            throw new RuntimeException(sprintf(
                'Aucune colonne de période ni de date dans « %s.%s » : impossible de savoir '
                . 'quel mois une facture couvre. Colonnes vues : %s.',
                $factureSchema,
                $factureTable,
                implode(', ', $this->inventory[$factureSchema . '.' . $factureTable]['disponibles'] ?? [])
            ));
        }

        $selection = [sprintf('f.`%s` AS erp_id', $facture['id']), sprintf('f.`%s` AS erp_shop', $facture['shop'])];
        foreach (['number', 'date', 'period_from', 'period_to', 'revenue', 'total', 'status'] as $notion) {
            if (isset($facture[$notion])) {
                $selection[] = sprintf('f.`%s` AS %s', $facture[$notion], $notion);
            }
        }

        // La facture porte sur le mois précédent celui où elle est émise : la
        // redevance d'avril est facturée en mai. Chercher avril dans les dates
        // d'émission ne trouverait donc rien — ou pire, trouverait mars.
        // Une colonne de période, quand elle existe, dit le mois couvert et
        // n'a pas besoin de ce décalage.
        $surPeriode = isset($facture['period_from']) && $colonneMois === $facture['period_from'];
        $fenetre    = $surPeriode
            ? ['depuis' => $premier, 'jusqu' => $dernier]
            : [
                'depuis' => (new \DateTimeImmutable($premier))->modify('+1 month')->format('Y-m-d'),
                'jusqu'  => (new \DateTimeImmutable($premier))
                    ->modify('+1 month')
                    ->modify('last day of this month')
                    ->format('Y-m-d'),
            ];

        $lecture = Database::connection()->prepare(sprintf(
            'SELECT %s FROM `%s`.`%s` f WHERE f.`%s` BETWEEN :depuis AND :jusqu ORDER BY f.`%s`',
            implode(', ', $selection),
            $factureSchema,
            $factureTable,
            $colonneMois,
            $facture['id']
        ));
        $lecture->execute([
            'depuis' => $fenetre['depuis'],
            'jusqu'  => $fenetre['jusqu'] . ' 23:59:59',
        ]);

        $factures = $lecture->fetchAll();
        if ($factures === []) {
            return ['mapping' => ['invoice' => $facture, 'line' => $ligne], 'invoices' => []];
        }

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

        $ids = array_map(static fn (array $f): string => (string) $f['erp_id'], $factures);

        $selectionLignes = [sprintf('l.`%s` AS erp_invoice', $ligne['invoice']), sprintf('l.`%s` AS amount', $ligne['amount'])];
        foreach (['label', 'kind', 'rate', 'base'] as $notion) {
            if (isset($ligne[$notion])) {
                $selectionLignes[] = sprintf('l.`%s` AS %s', $ligne[$notion], $notion);
            }
        }

        $lignes = Database::connection()->prepare(sprintf(
            'SELECT %s FROM `%s`.`%s` l WHERE l.`%s` IN (%s)',
            implode(', ', $selectionLignes),
            $ligneSchema,
            $ligneTable,
            $ligne['invoice'],
            implode(', ', array_fill(0, count($ids), '?'))
        ));
        $lignes->execute($ids);

        $parFacture = [];
        foreach ($lignes->fetchAll() as $l) {
            $parFacture[(string) $l['erp_invoice']][] = [
                'label'  => $l['label'] ?? null,
                'kind'   => $this->recognise((string) (($l['kind'] ?? '') . ' ' . ($l['label'] ?? ''))),
                'rate'   => isset($l['rate']) && $l['rate'] !== null ? (float) $l['rate'] : null,
                'base'   => isset($l['base']) && $l['base'] !== null ? (float) $l['base'] : null,
                'amount' => round((float) $l['amount'], 2),
            ];
        }

        $resultat = [];
        foreach ($factures as $f) {
            $rapproche = $boutiques[(string) $f['erp_shop']] ?? null;

            $resultat[] = [
                'erp_id'       => (string) $f['erp_id'],
                'shop_id'      => $rapproche['id'] ?? null,
                'shop_name'    => $rapproche['name'] ?? sprintf('Boutique ERP %s', $f['erp_shop']),
                'erp_shop_id'  => (string) $f['erp_shop'],
                'document_ref' => (string) ($f['number'] ?? sprintf('%s-%s', $factureTable, $f['erp_id'])),
                'invoice_date' => substr((string) ($f['date'] ?? $dernier), 0, 10),
                'period_from'  => substr((string) ($f['period_from'] ?? $premier), 0, 10),
                'period_to'    => substr((string) ($f['period_to'] ?? $dernier), 0, 10),
                'revenue'      => isset($f['revenue']) && $f['revenue'] !== null ? (float) $f['revenue'] : null,
                'total'        => isset($f['total']) && $f['total'] !== null ? (float) $f['total'] : null,
                'status'       => $f['status'] ?? null,
                'lines'        => $parFacture[(string) $f['erp_id']] ?? [],
            ];
        }

        return ['mapping' => ['invoice' => $facture, 'line' => $ligne], 'invoices' => $resultat];
    }

    /**
     * Nature d'une ligne, d'après son libellé — ou rien.
     *
     * Publique et statique parce qu'elle se vérifie sans base : c'est une règle
     * de lecture, et les tables de l'ERP n'ont pas à être imitées pour
     * l'éprouver.
     */
    public static function kindFromLabel(string $texte): ?string
    {
        return (new self())->recognise($texte);
    }

    /** Nature d'une ligne, d'après ce qu'elle dit d'elle-même. */
    private function recognise(string $texte): ?string
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

    /**
     * Table source, sous la forme `table` ou `schéma.table`.
     *
     * Le nom est validé strictement : il finit dans du SQL, où une table ne peut
     * pas être liée comme un paramètre.
     *
     * @return array{0:string, 1:string}
     */
    private function source(string $variable, string $default): array
    {
        $valeur = trim((string) (Env::get($variable, $default) ?: $default));

        if (preg_match('/^(?:([A-Za-z0-9_]+)\.)?([A-Za-z0-9_]+)$/', $valeur, $parts) !== 1) {
            throw new RuntimeException(sprintf(
                '%s doit être « table » ou « schéma.table » ; reçu « %s ».',
                $variable,
                $valeur
            ));
        }

        return [
            $parts[1] !== '' ? $parts[1] : (string) Database::connection()->query('SELECT DATABASE()')->fetchColumn(),
            $parts[2],
        ];
    }

    /**
     * Correspondance notion → colonne réelle, découverte dans le schéma.
     *
     * Ce qui n'a pas été reconnu est conservé avec la liste des colonnes
     * présentes : sans cet inventaire, une notion absente se traduit par un
     * champ vide, et rien ne dit si la colonne manque ou si elle porte un nom
     * auquel personne n'a pensé.
     *
     * @param  array<string, list<string>> $candidates
     * @param  list<string>                $required
     * @return array<string, string>
     */
    private function resolve(string $schema, string $table, array $candidates, array $required): array
    {
        $statement = Database::connection()->prepare(
            'SELECT column_name FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table
              ORDER BY ordinal_position'
        );
        $statement->execute(['schema' => $schema, 'table' => $table]);

        $presentes = $statement->fetchAll(PDO::FETCH_COLUMN);
        $minuscule = array_map('strtolower', $presentes);

        if ($presentes === []) {
            $this->inventory[$schema . '.' . $table] = ['disponibles' => [], 'non reconnues' => array_keys($candidates)];

            throw new RuntimeException(sprintf(
                'Table « %s.%s » introuvable, ou aucun droit de lecture dessus.',
                $schema,
                $table
            ));
        }

        $trouvees = [];
        foreach ($candidates as $notion => $noms) {
            foreach ($noms as $nom) {
                $rang = array_search(strtolower($nom), $minuscule, true);
                if ($rang !== false) {
                    $trouvees[$notion] = $presentes[$rang];
                    break;
                }
            }
        }

        $this->inventory[$schema . '.' . $table] = [
            'non reconnues' => array_values(array_diff(array_keys($candidates), array_keys($trouvees))),
            'disponibles'   => $presentes,
        ];

        $manquantes = array_diff($required, array_keys($trouvees));
        if ($manquantes !== []) {
            throw new RuntimeException(sprintf(
                'Colonnes indispensables introuvables dans « %s.%s » : %s. Colonnes vues : %s.',
                $schema,
                $table,
                implode(', ', $manquantes),
                implode(', ', $presentes)
            ));
        }

        return $trouvees;
    }
}
