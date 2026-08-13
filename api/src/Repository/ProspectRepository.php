<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Vivier de comptes B2B, et génération des leads d'une campagne.
 *
 * La génération ne fabrique pas de sociétés : elle puise dans un vivier importé
 * et le distribue. C'est la seule façon d'obtenir des leads qu'on puisse
 * réellement appeler — et, quand le vivier est vide, de le dire au lieu de
 * remplir un entonnoir avec des noms inventés.
 */
final class ProspectRepository
{
    /**
     * Nombre maximum de comptes rendus en une fois.
     *
     * La borne était à deux cents. Le réseau en compte neuf cents : le panneau
     * de l'assistant en montrait donc moins d'un quart, sans que le chiffre
     * annoncé et la liste affichée se contredisent nulle part — il fallait
     * compter les lignes à la main pour s'en apercevoir.
     *
     * Deux mille tient dans une page sans la figer, et couvre le réseau tel
     * qu'il est. Au-delà, la liste est tronquée et le dit : rendre trente mille
     * lignes ne rendrait service à personne.
     */
    private const LIST_MAX = 2000;

    /**
     * Effectif du vivier par secteur, en regard du chiffre de cadrage.
     *
     * Les deux sont affichés côte à côte parce qu'ils ne disent pas la même
     * chose : `estimated_leads_count` est une intention de démarchage,
     * `available` ce qu'on a réellement sous la main.
     *
     * @return list<array<string,mixed>>
     */
    public function summaryBySector(array $shopIds = []): array
    {
        // Boutiques données : l'effectif devient celui du périmètre. Sans cela
        // la pastille annonce « Horeca · 184 » quand la campagne locale n'en
        // touchera que douze, et c'est sur ce 184 qu'on décide de la cocher.
        [$shopSql, $shopBindings] = self::attachedTo($shopIds);

        // `COUNT(p.id)` et non `COUNT(ps.prospect_id)` : la jonction garde ses
        // lignes même quand le compte a été désactivé, et les compter
        // annoncerait un vivier plus fourni qu'il ne l'est.
        $statement = Database::connection()->prepare(sprintf(
            'SELECT s.id, s.code, s.label, s.estimated_leads_count,
                    COUNT(p.id) AS available
               FROM mar_b2b_sector s
               LEFT JOIN mar_b2b_prospect_sector ps ON ps.sector_id  = s.id
               LEFT JOIN mar_b2b_prospect p         ON p.id = ps.prospect_id
                    AND p.is_active = 1 %s
              WHERE s.is_active = 1
              GROUP BY s.id, s.code, s.label, s.estimated_leads_count, s.sort_order
              ORDER BY s.sort_order',
            $shopSql
        ));
        $statement->execute($shopBindings);

        $rows = $statement->fetchAll();

        foreach ($rows as &$row) {
            $row['id']                    = (int) $row['id'];
            $row['estimated_leads_count'] = (int) $row['estimated_leads_count'];
            $row['available']             = (int) $row['available'];
        }

        return $rows;
    }

    /**
     * Comptes du vivier, filtrés par secteur.
     *
     * Sert le panneau qui accompagne le choix des secteurs dans l'assistant :
     * annoncer « 184 comptes » sans pouvoir en nommer un seul n'engage à rien.
     * La boutique de rattachement y figure parce que c'est elle qui appellera.
     *
     * @param  list<int> $sectorIds
     * @return list<array<string,mixed>>
     */
    public function listBySectors(
        AuthContext $auth,
        array $sectorIds,
        array $shopIds = [],
        int $limit = self::LIST_MAX,
    ): array {
        if ($sectorIds === []) {
            return [];
        }

        [$scopeSql, $bindings] = Scope::shopFilter($auth, 'p.shop_id');
        [$placeholders, $sectorBindings] = Database::inClause($sectorIds, 'sector');
        [$shopSql, $shopBindings] = self::attachedTo($shopIds);

        // La limite est interpolée après bornage : MySQL refuse un paramètre
        // lié en LIMIT quand l'émulation des requêtes préparées est coupée.
        $limit = max(1, min(self::LIST_MAX, $limit));

        // Un compte relève de plusieurs secteurs : `EXISTS` plutôt qu'une
        // jointure, sinon il ressortirait une fois par secteur retenu et le
        // panneau annoncerait deux cents comptes là où il y en a quatre-vingts.
        // Le libellé, lui, les énumère tous — y compris ceux que la campagne ne
        // vise pas : c'est ce qui permet de voir qu'un traiteur coché au titre
        // de l'événementiel est aussi un client horeca.
        $statement = Database::connection()->prepare(sprintf(
            'SELECT p.id, p.company_name, p.contact_name, p.contact_email, p.city,
                    p.postal_code, p.shop_id, s.name AS shop_name,
                    (SELECT GROUP_CONCAT(sec.label ORDER BY sec.sort_order SEPARATOR \', \')
                       FROM mar_b2b_prospect_sector ls
                       JOIN mar_b2b_sector sec ON sec.id = ls.sector_id
                      WHERE ls.prospect_id = p.id) AS sector_label
               FROM mar_b2b_prospect p
               LEFT JOIN mar_shop s ON s.id = p.shop_id
              WHERE p.is_active = 1
                AND EXISTS (
                      SELECT 1 FROM mar_b2b_prospect_sector ps
                       WHERE ps.prospect_id = p.id AND ps.sector_id IN (%s)
                )
                AND (p.shop_id IS NULL OR %s)
                %s
              ORDER BY p.company_name
              LIMIT %d',
            $placeholders,
            $scopeSql,
            $shopSql,
            $limit
        ));
        $statement->execute($sectorBindings + $bindings + $shopBindings);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id']      = (int) $row['id'];
            $row['shop_id'] = $row['shop_id'] === null ? null : (int) $row['shop_id'];
        }

        return $rows;
    }

    /**
     * Nombre de comptes distincts sur un ensemble de secteurs.
     *
     * Additionner les effectifs par secteur donnerait un autre chiffre, et un
     * chiffre faux : un traiteur qui relève de l'horeca et de l'événementiel
     * compte une fois dans chacun, mais ne produira qu'un lead. L'assistant
     * annonçait ainsi trois comptes là où deux allaient être créés — un écart
     * qui ne se voit qu'après la génération, quand il est trop tard pour se
     * demander lequel des deux chiffres était le bon.
     *
     * @param list<int> $sectorIds
     */
    public function countBySectors(AuthContext $auth, array $sectorIds, array $shopIds = []): array
    {
        if ($sectorIds === []) {
            return ['total' => 0, 'network' => 0, 'without_shop' => 0];
        }

        [$scopeSql, $bindings]           = Scope::shopFilter($auth, 'p.shop_id');
        [$placeholders, $sectorBindings] = Database::inClause($sectorIds, 'sector');

        $compter = static function (string $condition, array $extra) use (
            $placeholders,
            $scopeSql,
            $sectorBindings,
            $bindings
        ): int {
            $statement = Database::connection()->prepare(sprintf(
                'SELECT COUNT(*)
                   FROM mar_b2b_prospect p
                  WHERE p.is_active = 1
                    AND EXISTS (
                          SELECT 1 FROM mar_b2b_prospect_sector ps
                           WHERE ps.prospect_id = p.id AND ps.sector_id IN (%s)
                    )
                    AND (p.shop_id IS NULL OR %s)
                    %s',
                $placeholders,
                $scopeSql,
                $condition
            ));
            $statement->execute($sectorBindings + $bindings + $extra);

            return (int) $statement->fetchColumn();
        };

        [$shopSql, $shopBindings] = self::attachedTo($shopIds);

        return [
            // Ce que la campagne démarchera réellement.
            'total'   => $compter($shopSql, $shopBindings),
            // Le vivier entier des mêmes secteurs : c'est l'écart entre les deux
            // qui dit ce que le choix des boutiques a écarté.
            'network' => $compter('', []),
            // Rattachés à aucune boutique. Ils ne relèvent d'aucun périmètre
            // local, et les taire ferait passer un trou de données pour un
            // vivier vide.
            'without_shop' => $shopIds === [] ? 0 : $compter('AND p.shop_id IS NULL', []),
        ];
    }

    /**
     * Restriction aux comptes rattachés à des boutiques données.
     *
     * `shop_id` du vivier vient de la boutique préférée du client dans l'ERP
     * (`client.id_main_shop`) : c'est celle où il a l'habitude d'aller, donc
     * celle qui l'appellera. Une campagne locale qui démarcherait un client
     * rattaché ailleurs enverrait quelqu'un travailler la clientèle d'une autre
     * boutique du réseau.
     *
     * Liste vide = aucune restriction : une campagne réseau vise tout le monde.
     *
     * `$avecOrphelins` distingue les deux usages, qui n'ont pas la même réponse
     * pour un compte sans boutique :
     *
     *   • **l'affichage** ne montre que les comptes rattachés — c'est ce qu'on
     *     demande à l'écran, « qui, chez moi, vais-je appeler » ;
     *   • **la génération** prend aussi les comptes orphelins et les répartit
     *     sur les boutiques de la campagne. C'est le comportement voulu depuis
     *     l'origine : un compte que l'ERP n'a rattaché à personne n'appartient
     *     à aucune boutique, il n'est donc volé à aucune.
     *
     * Dans les deux cas, un compte rattaché à une **autre** boutique est écarté.
     *
     * @param  list<int> $shopIds
     * @return array{0:string, 1:array<string,int>}
     */
    private static function attachedTo(array $shopIds, bool $avecOrphelins = false): array
    {
        if ($shopIds === []) {
            return ['', []];
        }

        [$placeholders, $bindings] = Database::inClause(array_values($shopIds), 'pshop');

        return [
            $avecOrphelins
                ? sprintf('AND (p.shop_id IS NULL OR p.shop_id IN (%s))', $placeholders)
                : sprintf('AND p.shop_id IN (%s)', $placeholders),
            $bindings,
        ];
    }

    /**
     * Import du vivier.
     *
     * Rejouable : une ligne portant une référence déjà connue met le compte à
     * jour au lieu d'en créer un second. Sans référence, on ne peut pas
     * reconnaître un doublon — la ligne est alors insérée telle quelle, et le
     * rapport le signale plutôt que de le passer sous silence.
     *
     * @param  list<array<string,mixed>> $rows
     * @return array{imported:int, updated:int, skipped:int, without_ref:int, errors:list<string>}
     */
    public function import(AuthContext $auth, int $brandId, array $rows, ?string $source): array
    {
        $connection = Database::connection();

        $brand = $connection->prepare('SELECT 1 FROM mar_brand WHERE id = :id AND is_active = 1');
        $brand->execute(['id' => $brandId]);
        if ($brand->fetchColumn() === false) {
            throw new RuntimeException('Marque introuvable ou inactive.');
        }

        $sectors = [];
        foreach ($connection->query('SELECT id, code, label FROM mar_b2b_sector')->fetchAll() as $sector) {
            $sectors[mb_strtolower((string) $sector['code'])]  = (int) $sector['id'];
            $sectors[mb_strtolower((string) $sector['label'])] = (int) $sector['id'];
        }

        $report = ['imported' => 0, 'updated' => 0, 'skipped' => 0, 'without_ref' => 0, 'errors' => []];

        $connection->beginTransaction();

        try {
            // `id = LAST_INSERT_ID(id)` : sans cette affectation, MySQL ne
            // renseigne `lastInsertId()` que sur une insertion. Un compte déjà
            // connu repartirait donc sans identifiant, et son secteur ne serait
            // jamais rattaché — précisément le cas d'un fichier réimporté.
            $insert = $connection->prepare(
                'INSERT INTO mar_b2b_prospect
                    (brand_id, external_ref, company_name, contact_name, contact_email,
                     contact_phone, size_label, potential_amount, city, postal_code, source, created_by)
                 VALUES
                    (:brand_id, :external_ref, :company_name, :contact_name, :contact_email,
                     :contact_phone, :size_label, :potential_amount, :city, :postal_code, :source, :created_by)
                 ON DUPLICATE KEY UPDATE
                    id               = LAST_INSERT_ID(id),
                    company_name     = VALUES(company_name),
                    contact_name     = VALUES(contact_name),
                    contact_email    = VALUES(contact_email),
                    contact_phone    = VALUES(contact_phone),
                    size_label       = VALUES(size_label),
                    potential_amount = VALUES(potential_amount),
                    city             = VALUES(city),
                    postal_code      = VALUES(postal_code),
                    is_active        = 1'
            );

            $link = $connection->prepare(
                'INSERT IGNORE INTO mar_b2b_prospect_sector (prospect_id, sector_id)
                 VALUES (:prospect_id, :sector_id)'
            );

            foreach ($rows as $index => $row) {
                $company = trim((string) ($row['company_name'] ?? ''));
                if ($company === '') {
                    $report['skipped']++;
                    $report['errors'][] = sprintf('Ligne %d : nom de société absent.', $index + 1);
                    continue;
                }

                $sectorKey = mb_strtolower(trim((string) ($row['sector'] ?? '')));
                $sectorId  = $sectors[$sectorKey] ?? null;

                if ($sectorKey !== '' && $sectorId === null) {
                    $report['skipped']++;
                    $report['errors'][] = sprintf('Ligne %d : secteur « %s » inconnu.', $index + 1, $row['sector']);
                    continue;
                }

                $ref = trim((string) ($row['external_ref'] ?? ''));
                if ($ref === '') {
                    $report['without_ref']++;
                }

                $insert->execute([
                    'brand_id'         => $brandId,
                    'external_ref'     => $ref !== '' ? $ref : null,
                    'company_name'     => $company,
                    'contact_name'     => self::text($row['contact_name'] ?? null),
                    'contact_email'    => self::text($row['contact_email'] ?? null),
                    'contact_phone'    => self::text($row['contact_phone'] ?? null),
                    'size_label'       => self::text($row['size_label'] ?? null),
                    'potential_amount' => self::number($row['potential_amount'] ?? null),
                    'city'             => self::text($row['city'] ?? null),
                    'postal_code'      => self::text($row['postal_code'] ?? null),
                    'source'           => $source,
                    'created_by'       => $auth->userId,
                ]);

                // rowCount vaut 1 sur une insertion, 2 sur une mise à jour par
                // ON DUPLICATE KEY, 0 quand la ligne existait à l'identique.
                if ($insert->rowCount() === 1) {
                    $report['imported']++;
                } else {
                    $report['updated']++;
                }

                // Le secteur s'ajoute, il ne remplace pas : un compte en a
                // plusieurs, et un fichier qui n'en nomme qu'un ne dit rien des
                // autres. Les effacer retirerait au passage ceux que la reprise
                // ERP a rattachés, sans que le fichier ait prétendu le faire.
                if ($sectorId !== null) {
                    $link->execute([
                        'prospect_id' => (int) $connection->lastInsertId(),
                        'sector_id'   => $sectorId,
                    ]);
                }
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        return $report;
    }

    /**
     * Crée les leads d'une campagne à partir du vivier.
     *
     * Rejouable sans dommage : les comptes déjà transformés en lead pour cette
     * campagne sont écartés, l'unicité (campagne, compte) le garantit même en
     * cas d'appels concurrents. Relancer après un import complémentaire ne crée
     * donc que les nouveaux.
     *
     * @return array{created:int, skipped_existing:int, available:int, shops:int, reason:?string}
     */
    public function generateLeads(AuthContext $auth, int $campaignId): array
    {
        $connection = Database::connection();

        $campaign = $this->campaignForGeneration($auth, $campaignId);
        $shopIds  = $this->targetShops($auth, $campaign);

        $sectorIds = array_map(
            'intval',
            $this->fetchColumn(
                'SELECT sector_id FROM mar_campaign_b2b_sector WHERE campaign_id = :id',
                ['id' => $campaignId]
            )
        );

        $empty = ['created' => 0, 'skipped_existing' => 0, 'available' => 0, 'shops' => count($shopIds)];

        if ($campaign['client_target'] === 'b2c') {
            return $empty + ['reason' => 'Campagne B2C : il n’y a pas de compte professionnel à démarcher.'];
        }

        if ($sectorIds === []) {
            return $empty + ['reason' => 'Aucun secteur retenu sur la campagne.'];
        }

        if ($shopIds === []) {
            return $empty + ['reason' => 'Aucune boutique à qui distribuer les comptes.'];
        }

        [$placeholders, $bindings]     = Database::inClause($sectorIds, 'sector');
        [$pickPlaceholders, $pickBind] = Database::inClause($sectorIds, 'pick');

        // Une campagne locale ne démarche pas la clientèle d'une autre boutique.
        // Sans ce filtre, un compte rattaché à Gosselies entrait dans une
        // campagne de Corbais, et personne ne s'en apercevait avant l'appel.
        // Les comptes sans rattachement, eux, restent pris et répartis : ils
        // n'appartiennent à personne, ils ne sont donc volés à personne.
        [$shopSql, $shopBind] = $campaign['scope'] === 'LOCALE'
            ? self::attachedTo($shopIds, true)
            : ['', []];

        $bindings                 += $pickBind + $shopBind;
        $bindings['brand_id']      = $campaign['brand_id'];
        $bindings['campaign_id']   = $campaignId;

        // Deux jeux de paramètres pour la même liste : PDO sans émulation
        // refuse qu'un paramètre nommé serve deux fois dans la requête.
        //
        // Le secteur porté par le lead est celui de la campagne, pas tous ceux
        // du compte : un traiteur relevant de l'horeca et de l'événementiel
        // apparaît sous le secteur au titre duquel il est démarché, sans quoi
        // le suivi le classerait sous un secteur que la campagne ne vise pas.
        //
        // Les comptes déjà transformés pour cette campagne sont écartés ici
        // plutôt que rattrapés par l'erreur d'unicité : on veut un compte
        // rendu juste, pas seulement l'absence de doublon.
        $statement = $connection->prepare(sprintf(
            'SELECT p.id, p.company_name, p.contact_name, p.contact_email, p.contact_phone,
                    p.size_label, p.potential_amount, p.shop_id,
                    (SELECT ps.sector_id
                       FROM mar_b2b_prospect_sector ps
                       JOIN mar_b2b_sector sc ON sc.id = ps.sector_id
                      WHERE ps.prospect_id = p.id AND ps.sector_id IN (%s)
                      ORDER BY sc.sort_order, sc.id
                      LIMIT 1) AS sector_id
               FROM mar_b2b_prospect p
              WHERE p.is_active = 1
                AND p.brand_id  = :brand_id
                AND EXISTS (
                      SELECT 1 FROM mar_b2b_prospect_sector ps
                       WHERE ps.prospect_id = p.id AND ps.sector_id IN (%s)
                )
                AND NOT EXISTS (
                      SELECT 1 FROM mar_crm_lead ld
                       WHERE ld.campaign_id = :campaign_id AND ld.prospect_id = p.id
                )
                %s
              ORDER BY p.company_name',
            $pickPlaceholders,
            $placeholders,
            $shopSql
        ));
        $statement->execute($bindings);
        $prospects = $statement->fetchAll();

        $already = (int) $this->fetchOne(
            'SELECT COUNT(*) FROM mar_crm_lead WHERE campaign_id = :id AND prospect_id IS NOT NULL',
            ['id' => $campaignId]
        );

        if ($prospects === []) {
            return [
                'created'          => 0,
                'skipped_existing' => $already,
                'available'        => 0,
                'shops'            => count($shopIds),
                'reason'           => $already > 0
                    ? 'Tous les comptes des secteurs retenus sont déjà rattachés à cette campagne.'
                    : 'Le vivier ne contient aucun compte pour les secteurs retenus.',
            ];
        }

        $firstStatus = (string) $this->fetchOne(
            'SELECT code FROM mar_lead_status ORDER BY sort_order LIMIT 1'
        );

        $connection->beginTransaction();

        try {
            $insert = $connection->prepare(
                'INSERT INTO mar_crm_lead
                    (campaign_id, sector_id, prospect_id, shop_id, company_name, contact_name,
                     contact_email, contact_phone, size_label, potential_amount, status_code, created_by)
                 VALUES
                    (:campaign_id, :sector_id, :prospect_id, :shop_id, :company_name, :contact_name,
                     :contact_email, :contact_phone, :size_label, :potential_amount, :status_code, :created_by)'
            );

            $event = $connection->prepare(
                'INSERT INTO mar_crm_lead_event (lead_id, from_status, to_status, event_type, note, user_id)
                 VALUES (:lead_id, NULL, :to_status, \'NOTE\', :note, :user_id)'
            );

            $created = 0;

            // Charge déjà en place, et non un curseur repartant de zéro : une
            // génération relancée après un import complémentaire recommencerait
            // sinon par la première boutique à chaque fois, et lui empilerait
            // tous les comptes ajoutés au fil de l'eau.
            $load = $this->leadsPerShop($campaignId, $shopIds);

            foreach ($prospects as $prospect) {
                // Boutique référente si le vivier la connaît, sinon la moins
                // chargée : à défaut d'information géographique fiable, une
                // charge égale vaut mieux qu'un tas chez le premier de la liste.
                $shopId = $prospect['shop_id'] !== null && in_array((int) $prospect['shop_id'], $shopIds, true)
                    ? (int) $prospect['shop_id']
                    : (int) array_search(min($load), $load, true);

                $load[$shopId]++;

                $insert->execute([
                    'campaign_id'      => $campaignId,
                    'sector_id'        => $prospect['sector_id'],
                    'prospect_id'      => $prospect['id'],
                    'shop_id'          => $shopId,
                    'company_name'     => $prospect['company_name'],
                    'contact_name'     => $prospect['contact_name'],
                    'contact_email'    => $prospect['contact_email'],
                    'contact_phone'    => $prospect['contact_phone'],
                    'size_label'       => $prospect['size_label'],
                    'potential_amount' => $prospect['potential_amount'],
                    'status_code'      => $firstStatus,
                    'created_by'       => $auth->userId,
                ]);

                $event->execute([
                    'lead_id'   => (int) $connection->lastInsertId(),
                    'to_status' => $firstStatus,
                    'note'      => 'Créé depuis le vivier B2B',
                    'user_id'   => $auth->userId,
                ]);

                $created++;
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        return [
            'created'          => $created,
            'skipped_existing' => $already,
            'available'        => count($prospects),
            'shops'            => count($shopIds),
            'reason'           => null,
        ];
    }

    /**
     * Nombre de leads déjà rattachés, par boutique de la campagne.
     *
     * Les boutiques sans lead figurent à zéro : ce sont justement elles qui
     * doivent servir en premier.
     *
     * @param  list<int> $shopIds
     * @return array<int,int>
     */
    private function leadsPerShop(int $campaignId, array $shopIds): array
    {
        $load = array_fill_keys($shopIds, 0);

        $statement = Database::connection()->prepare(
            'SELECT shop_id, COUNT(*) AS total
               FROM mar_crm_lead
              WHERE campaign_id = :id AND shop_id IS NOT NULL
              GROUP BY shop_id'
        );
        $statement->execute(['id' => $campaignId]);

        foreach ($statement->fetchAll() as $row) {
            $shopId = (int) $row['shop_id'];
            if (array_key_exists($shopId, $load)) {
                $load[$shopId] = (int) $row['total'];
            }
        }

        return $load;
    }

    /**
     * Campagne visée, vérifiée pour l'écriture.
     *
     * Le contrôle est le même qu'en lecture, mais il est refait ici : générer
     * des leads écrit dans le périmètre d'autrui si on s'en remet à l'appelant.
     *
     * @return array<string,mixed>
     */
    private function campaignForGeneration(AuthContext $auth, int $campaignId): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');
        $bindings['id']        = $campaignId;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.id, c.brand_id, c.scope, c.client_target
               FROM mar_campaign c
              WHERE c.id = :id AND %s',
            $scopeSql
        ));
        $statement->execute($bindings);

        $campaign = $statement->fetch();
        if ($campaign === false) {
            throw new RuntimeException('Campagne hors périmètre ou introuvable.');
        }

        $campaign['brand_id'] = (int) $campaign['brand_id'];

        return $campaign;
    }

    /**
     * Boutiques destinataires.
     *
     * Une campagne locale distribue à ses boutiques ; une campagne réseau à
     * toutes celles de la marque. Dans les deux cas, un franchisé ne reçoit que
     * les siennes — sinon la génération deviendrait un moyen d'écrire chez le
     * voisin.
     *
     * @param  array<string,mixed> $campaign
     * @return list<int>
     */
    private function targetShops(AuthContext $auth, array $campaign): array
    {
        $campaignId = (int) $campaign['id'];

        $shopIds = $campaign['scope'] === 'LOCALE'
            ? $this->fetchColumn(
                'SELECT shop_id FROM mar_campaign_shop WHERE campaign_id = :id',
                ['id' => $campaignId]
            )
            : $this->fetchColumn(
                'SELECT id FROM mar_shop WHERE brand_id = :brand_id',
                ['brand_id' => $campaign['brand_id']]
            );

        $shopIds = array_map('intval', $shopIds);
        $allowed = Scope::shopIds($auth);

        if ($allowed !== null) {
            $shopIds = array_values(array_intersect($shopIds, $allowed));
        }

        sort($shopIds);

        return $shopIds;
    }

    /** @param array<string,mixed> $bindings @return list<string> */
    private function fetchColumn(string $sql, array $bindings = []): array
    {
        $statement = Database::connection()->prepare($sql);
        $statement->execute($bindings);

        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    /** @param array<string,mixed> $bindings */
    private function fetchOne(string $sql, array $bindings = []): mixed
    {
        $statement = Database::connection()->prepare($sql);
        $statement->execute($bindings);

        return $statement->fetchColumn();
    }

    private static function text(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : $value;

        return $value === null || $value === '' ? null : (string) $value;
    }

    private static function number(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        // Les exports européens écrivent « 1 250,50 » : sans normalisation, la
        // conversion s'arrête au premier séparateur et retient 1.
        $normalised = str_replace([' ', "\u{00A0}", ','], ['', '', '.'], (string) $value);

        return is_numeric($normalised) ? (float) $normalised : null;
    }
}
