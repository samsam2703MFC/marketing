<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use PDO;
use RuntimeException;

/** Campagnes : liste, fiche, calendrier, suivi en direct, écriture. */
final class CampaignRepository
{
    /**
     * Critères de classement du challenge.
     *
     * `attainment` — part de son propre objectif atteinte. C'est le seul qui
     * mette des boutiques de tailles différentes sur la même ligne de départ.
     * `pieces` — volume brut : la plus grosse boutique gagne d'avance.
     * `growth` — écart au N-1 : favorise celle qui partait de bas.
     *
     * @var list<string>
     */
    private const CHALLENGE_METRICS = ['attainment', 'pieces', 'growth'];

    /**
     * Mécaniques de promotion reconnues — les codes de `mar_promotion_mechanic`.
     *
     * Recopiés plutôt que relus : une mécanique inconnue doit être refusée avec
     * un message, et une table de référence vide ne doit pas laisser passer
     * n'importe quoi. Le jour où une sixième arrive, elle s'ajoute ici et dans
     * la table — le décalage se voit au premier test.
     *
     * @var list<string>
     */
    private const MECHANICS = [
        'PERCENT', 'CROSSED_PRICE', 'BUY_X_GET_Y', 'BUNDLE_FIXED', 'FREE_DELIVERY',
    ];

    /**
     * Liste filtrable. Le périmètre s'applique en SQL : un franchisé ne reçoit
     * que les campagnes réseau et celles où l'une de ses boutiques participe.
     *
     * @param  array{status?:?string, scope?:?string, brand_id?:?int} $filters
     * @return list<array<string,mixed>>
     */
    public function list(AuthContext $auth, array $filters = []): array
    {
        [$scopeSql, $scopeBindings] = Scope::campaignFilter($auth);

        $where    = [$scopeSql];
        $bindings = $scopeBindings;

        if (!empty($filters['status'])) {
            $where[]            = 'c.status_code = :status';
            $bindings['status'] = $filters['status'];
        }

        if (!empty($filters['scope'])) {
            $where[]           = 'c.scope = :scope';
            $bindings['scope'] = $filters['scope'];
        }

        if (!empty($filters['brand_id'])) {
            $where[]              = 'c.brand_id = :brand_id';
            $bindings['brand_id'] = $filters['brand_id'];
        }

        $sql = sprintf(
            'SELECT
                c.id, c.name, c.scope, c.client_target, c.status_code, c.starts_on, c.ends_on,
                c.budget_amount, c.spent_amount, c.image_url, c.approval_status,
                c.create_crm_leads, c.parent_campaign_id,
                b.name  AS brand_name,
                t.label AS type_label,
                t.code  AS type_code,
                st.label    AS status_label,
                st.text_hex AS status_text_hex,
                st.bg_rgba  AS status_bg_rgba,
                (SELECT COUNT(*) FROM mar_campaign_shop cs WHERE cs.campaign_id = c.id) AS shops_count
             FROM mar_campaign c
             JOIN mar_brand b            ON b.id = c.brand_id
             JOIN mar_campaign_status st ON st.code = c.status_code
             LEFT JOIN mar_campaign_type t ON t.id = c.type_id
             WHERE %s
             ORDER BY c.starts_on DESC, c.id DESC',
            implode(' AND ', $where)
        );

        $statement = Database::connection()->prepare($sql);
        $statement->execute($bindings);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return array<string,mixed>|null */
    public function find(AuthContext $auth, int $id): ?array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth);
        $bindings['id']        = $id;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.*, b.name AS brand_name, t.label AS type_label,
                    st.label AS status_label, st.text_hex AS status_text_hex, st.bg_rgba AS status_bg_rgba
               FROM mar_campaign c
               JOIN mar_brand b            ON b.id = c.brand_id
               JOIN mar_campaign_status st ON st.code = c.status_code
               LEFT JOIN mar_campaign_type t ON t.id = c.type_id
              WHERE c.id = :id AND %s',
            $scopeSql
        ));
        $statement->execute($bindings);

        $row = $statement->fetch();
        if ($row === false) {
            return null;
        }

        $row = $this->castRow($row);

        $row['shops']         = $this->shops($id);
        $row['levers']        = $this->leverTargets($id);
        $row['retroplanning'] = $this->retroplanning($id);
        $row['offer']         = $this->offer($id);
        $row['sectors']       = $this->sectors($id);

        // Le reste du cadrage saisi à la création. Sans ces lectures, le brief
        // était enregistré et illisible : l'agence pouvait le remplir, personne
        // ne pouvait le relire.
        $row['tone_label']   = $this->labelOf('mar_tone', 'code', $row['tone'] ?? null);
        $row['agency_asks']  = $this->joined(
            'SELECT a.label FROM mar_campaign_agency_ask ca
               JOIN mar_agency_ask a ON a.id = ca.ask_id
              WHERE ca.campaign_id = :id ORDER BY a.sort_order',
            $id
        );
        $row['b2b_options']  = $this->joined(
            'SELECT o.label FROM mar_campaign_b2b_option co
               JOIN mar_b2b_option o ON o.id = co.option_id
              WHERE co.campaign_id = :id ORDER BY o.sort_order',
            $id
        );
        $row['uniforms']     = $this->joined(
            'SELECT u.name FROM mar_campaign_uniform cu
               JOIN mar_uniform u ON u.id = cu.uniform_id
              WHERE cu.campaign_id = :id ORDER BY u.sort_order',
            $id
        );
        $row['channels']     = $this->campaignChannels($id);
        $row['pos_questions'] = $this->posQuestions($id);
        $row['assets']       = $this->assets($id);

        return $row;
    }

    /**
     * Frise annuelle : une barre par campagne, positionnée par mois de début et
     * étalée sur sa durée. Le calcul vit ici plutôt que dans le front, qui ne
     * doit pas connaître la règle de découpage.
     *
     * @return list<array<string,mixed>>
     */
    public function calendar(AuthContext $auth, int $year): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth);

        // Deux placeholders distincts pour la même valeur : les requêtes préparées
        // côté serveur (EMULATE_PREPARES désactivé) refusent qu'un paramètre nommé
        // soit lié à plusieurs positions.
        $bindings['year_start'] = $year;
        $bindings['year_end']   = $year;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.id, c.name, c.scope, c.status_code, c.starts_on, c.ends_on,
                    st.label AS status_label, st.text_hex AS status_text_hex, st.bg_rgba AS status_bg_rgba
               FROM mar_campaign c
               JOIN mar_campaign_status st ON st.code = c.status_code
              WHERE %s
                AND c.starts_on IS NOT NULL
                AND YEAR(c.starts_on) <= :year_start
                AND (c.ends_on IS NULL OR YEAR(c.ends_on) >= :year_end)
              ORDER BY c.starts_on',
            $scopeSql
        ));
        $statement->execute($bindings);

        $rows = [];
        foreach ($statement->fetchAll() as $row) {
            $startMonth = (int) date('n', strtotime((string) $row['starts_on']));
            $endMonth   = $row['ends_on'] !== null
                ? (int) date('n', strtotime((string) $row['ends_on']))
                : $startMonth;

            // Une campagne à cheval sur l'année se tronque aux bornes affichées.
            $startYear = (int) date('Y', strtotime((string) $row['starts_on']));
            $endYear   = $row['ends_on'] !== null ? (int) date('Y', strtotime((string) $row['ends_on'])) : $startYear;

            $start = $startYear < $year ? 1  : $startMonth;
            $end   = $endYear   > $year ? 12 : $endMonth;

            $row['start_month'] = $start;
            $row['span_months'] = max(1, $end - $start + 1);
            $rows[]             = $this->castRow($row);
        }

        return $rows;
    }

    /**
     * Suivi en direct : KPI réseau et classement des boutiques.
     *
     * @return array{kpis:list<array<string,mixed>>, shops:list<array<string,mixed>>}
     */
    public function monitor(AuthContext $auth, int $campaignId): array
    {
        if ($this->find($auth, $campaignId) === null) {
            throw new RuntimeException('Campagne hors périmètre ou introuvable.');
        }

        $connection = Database::connection();

        $kpis = $connection->prepare(
            'SELECT kpi_code, kpi_label, value, target_value, unit, measured_at, attainment_pct
               FROM mar_v_campaign_monitor
              WHERE campaign_id = :id AND shop_id IS NULL
              ORDER BY kpi_code'
        );
        $kpis->execute(['id' => $campaignId]);

        $shops = $connection->prepare(
            'SELECT shop_id, shop_name, kpi_code, value, target_value, attainment_pct
               FROM mar_v_campaign_monitor
              WHERE campaign_id = :id AND shop_id IS NOT NULL
              ORDER BY attainment_pct DESC'
        );
        $shops->execute(['id' => $campaignId]);

        return [
            'kpis'  => array_map([$this, 'castRow'], $kpis->fetchAll()),
            'shops' => array_map([$this, 'castRow'], $shops->fetchAll()),
        ];
    }

    /** @param array<string,mixed> $data */
    public function create(AuthContext $auth, array $data): int
    {
        if (($data['name'] ?? '') === '' || $data['name'] === null) {
            throw new RuntimeException('Champs obligatoires manquants : name');
        }

        $data = $this->validated($auth, $data);

        // La marque ne se saisit plus : on est dans un back-office, elle est
        // connue du contexte. Le client peut la préciser — le sélecteur de
        // marque de la barre latérale, quand un réseau en exploite plusieurs —
        // sinon on la déduit.
        $brandId = $this->resolveBrandId($auth, $data['brand_id'] ?? null);

        $connection = Database::connection();
        $statement  = $connection->prepare(
            'INSERT INTO mar_campaign
                (brand_id, type_id, parent_campaign_id, name, scope, client_target, tone,
                 status_code, draft_step, starts_on, ends_on, budget_amount, objective_coef_pct,
                 agency_note, b2b_webshop_enabled, pos_survey_enabled, owner_user_id,
                 create_crm_leads, image_url,
                 challenge_enabled, challenge_metric, challenge_trigger_pct,
                 margin_pct_default, created_by)
             VALUES
                (:brand_id, :type_id, :parent_campaign_id, :name, :scope, :client_target, :tone,
                 :status_code, :draft_step, :starts_on, :ends_on, :budget_amount, :objective_coef_pct,
                 :agency_note, :b2b_webshop_enabled, :pos_survey_enabled, :owner_user_id,
                 :create_crm_leads, :image_url,
                 :challenge_enabled, :challenge_metric, :challenge_trigger_pct,
                 :margin_pct_default, :created_by)'
        );

        $statement->execute([
            'brand_id'           => $brandId,
            'client_target'      => $data['client_target'],
            'type_id'            => $data['type_id'] ?? null,
            'parent_campaign_id' => $data['parent_campaign_id'] ?? null,
            'name'               => $data['name'],
            'scope'              => $data['scope'],
            'status_code'        => $data['status_code'] ?? 'draft',
            'draft_step'         => ($data['draft_step'] ?? null) ?: null,
            'starts_on'          => $data['starts_on'] ?? null,
            'ends_on'            => $data['ends_on'] ?? null,
            'budget_amount'      => $data['budget_amount'] ?? 0,
            'owner_user_id'      => $data['owner_user_id'] ?? $auth->userId,
            'tone'               => ($data['tone'] ?? null) ?: null,
            'objective_coef_pct' => ($data['objective_coef_pct'] ?? '') === '' || ($data['objective_coef_pct'] ?? null) === null
                ? null
                : $data['objective_coef_pct'],
            'agency_note'        => ($data['agency_note'] ?? null) ?: null,
            'b2b_webshop_enabled'=> !empty($data['b2b_webshop_enabled']) ? 1 : 0,
            'pos_survey_enabled' => !empty($data['pos_survey_enabled']) ? 1 : 0,
            'create_crm_leads'   => !empty($data['create_crm_leads']) ? 1 : 0,
            'image_url'          => $data['image_url'] ?? null,
            // Le challenge se règle à l'étape « Objectifs », donc bien après la
            // première écriture. Ces colonnes sont ici pour que le premier
            // enregistrement d'un assistant déjà rempli ne les perde pas — sans
            // elles, il fallait sauver deux fois pour que le challenge tienne.
            'challenge_enabled'  => !empty($data['challenge_enabled']) ? 1 : 0,
            'challenge_metric'   => $data['challenge_metric'] ?? null,
            'challenge_trigger_pct' => ($data['challenge_trigger_pct'] ?? '') === ''
                ? null
                : $data['challenge_trigger_pct'],
            'margin_pct_default' => ($data['margin_pct_default'] ?? '') === ''
                ? null
                : $data['margin_pct_default'],
            'created_by'         => $auth->userId,
        ]);

        return (int) $connection->lastInsertId();
    }

    /**
     * Droit d'écriture sur une campagne existante.
     *
     * Voir une campagne et pouvoir la modifier sont deux choses distinctes, et
     * le code les confondait : une campagne réseau est visible de tous les
     * franchisés — c'est voulu, ils doivent la relayer — et le seul contrôle
     * avant écriture était cette visibilité. Un franchisé pouvait donc
     * renommer, rebudgéter, et surtout supprimer une campagne du réseau.
     *
     * @param array<string,mixed> $campaign
     */
    private function assertWritable(AuthContext $auth, array $campaign): void
    {
        if ($auth->isBrandAdmin()) {
            return;
        }

        if (($campaign['scope'] ?? null) !== 'LOCALE') {
            throw new RuntimeException('Une campagne réseau ne se modifie qu\'au niveau du réseau.');
        }
    }

    /**
     * Contrôle des données de campagne avant écriture.
     *
     * Trois raisons de le faire ici plutôt que dans le formulaire :
     *
     * — La portée est une règle de sécurité. L'assistant impose « locale » à un
     *   franchisé, mais un appel direct à l'API contournait cette contrainte et
     *   créait une campagne réseau, visible de tout le monde.
     * — Une valeur inconnue était silencieusement ramenée à « RESEAU », c'est-à-
     *   dire à la plus permissive. Une faute de frappe élargissait le périmètre.
     * — Un statut absent du référentiel ou un coefficient hors bornes partaient
     *   jusqu'à MySQL, qui les refusait par contrainte : le client recevait une
     *   erreur interne là où il aurait dû lire ce qu'il devait corriger.
     *
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    private function validated(AuthContext $auth, array $data): array
    {
        $scope = $data['scope'] ?? 'RESEAU';
        if (!in_array($scope, ['RESEAU', 'LOCALE'], true)) {
            throw new RuntimeException('Portée inconnue : attendu RESEAU ou LOCALE.');
        }

        if (!$auth->isBrandAdmin() && $scope !== 'LOCALE') {
            throw new RuntimeException('Une boutique ne crée que des campagnes locales.');
        }

        $data['scope'] = $scope;

        $target = $data['client_target'] ?? 'b2c';
        if (!in_array($target, ['b2c', 'b2b', 'mixte'], true)) {
            throw new RuntimeException('Cible client inconnue : attendu b2c, b2b ou mixte.');
        }

        $data['client_target'] = $target;

        $startsOn = $data['starts_on'] ?? null;
        $endsOn   = $data['ends_on'] ?? null;
        if ($startsOn && $endsOn && $endsOn < $startsOn) {
            throw new RuntimeException('La date de fin précède la date de début.');
        }

        if (isset($data['budget_amount']) && $data['budget_amount'] !== '' && (float) $data['budget_amount'] < 0) {
            throw new RuntimeException('Le budget ne peut pas être négatif.');
        }

        // DECIMAL(5,2) : au-delà, MySQL refuse la valeur en mode strict.
        $coef = $data['objective_coef_pct'] ?? null;
        if ($coef !== null && $coef !== '' && abs((float) $coef) > 999.99) {
            throw new RuntimeException('L\'écart au N-1 doit rester entre -999,99 et 999,99 %.');
        }

        $data = $this->validatedChallenge($data);

        $connection = Database::connection();

        $status = $data['status_code'] ?? 'draft';
        $known  = $connection->prepare('SELECT 1 FROM mar_campaign_status WHERE code = :code');
        $known->execute(['code' => $status]);
        if ($known->fetchColumn() === false) {
            $codes = $connection->query('SELECT code FROM mar_campaign_status ORDER BY sort_order')
                ->fetchAll(PDO::FETCH_COLUMN);

            throw new RuntimeException(sprintf(
                'État de campagne inconnu : attendu %s.',
                implode(', ', $codes)
            ));
        }

        $data['status_code'] = $status;

        if (!empty($data['type_id'])) {
            $known = $connection->prepare('SELECT 1 FROM mar_campaign_type WHERE id = :id');
            $known->execute(['id' => (int) $data['type_id']]);
            if ($known->fetchColumn() === false) {
                throw new RuntimeException('Type de campagne inconnu.');
            }
        }

        return $data;
    }

    /**
     * Promotion d'une ligne d'offre, normalisée pour l'écriture.
     *
     * Seuls les champs de la mécanique retenue sont conservés : passer de
     * « −20 % » à « prix barré 15,90 € » sans effacer le pourcentage laisserait
     * deux promotions écrites sur la même ligne, et le calcul de marge
     * choisirait la mauvaise sans jamais s'en plaindre.
     *
     * @param  array<string,mixed> $item
     * @return array<string,mixed>
     */
    private function pricingOf(array $item): array
    {
        $mechanic = trim((string) ($item['mechanic_type'] ?? ''));

        if ($mechanic !== '' && !in_array($mechanic, self::MECHANICS, true)) {
            throw new RuntimeException(sprintf(
                'Mécanique de promotion inconnue : attendu %s.',
                implode(', ', self::MECHANICS)
            ));
        }

        $number = static function (mixed $value, float $max): ?float {
            if ($value === null || $value === '') {
                return null;
            }

            return min($max, max(0, (float) $value));
        };

        $count = static function (mixed $value): ?int {
            if ($value === null || $value === '') {
                return null;
            }

            return min(999, max(0, (int) $value));
        };

        // Le prix de référence et le taux de marge survivent au changement de
        // mécanique : ils décrivent le produit, pas la promotion.
        $pricing = [
            'mechanic_type'  => $mechanic === '' ? null : $mechanic,
            'discount_pct'   => null,
            'fixed_price'    => null,
            'buy_qty'        => null,
            'get_qty'        => null,
            'baseline_price' => $number($item['baseline_price'] ?? null, 999999.99),
            'margin_pct'     => $number($item['margin_pct'] ?? null, 100),
            // Un objectif vide n'est pas un objectif à zéro : le premier veut
            // dire « non posé », le second « ne vendez rien ».
            'target_pieces'  => ($item['target_pieces'] ?? '') === '' || ($item['target_pieces'] ?? null) === null
                ? null
                : max(0, (int) $item['target_pieces']),
        ];

        if ($mechanic === 'PERCENT') {
            $pricing['discount_pct'] = $number($item['discount_pct'] ?? null, 100);
        }

        if ($mechanic === 'CROSSED_PRICE' || $mechanic === 'BUNDLE_FIXED') {
            $pricing['fixed_price'] = $number($item['fixed_price'] ?? null, 999999.99);
        }

        if ($mechanic === 'BUY_X_GET_Y') {
            $pricing['buy_qty'] = $count($item['buy_qty'] ?? null);
            $pricing['get_qty'] = $count($item['get_qty'] ?? null);
        }

        return $pricing;
    }

    /**
     * Réglages du challenge, validés.
     *
     * Le challenge est facultatif : sans lui, les objectifs restent des
     * objectifs et rien de ce qui suit ne s'applique. Trois contrôles, tous
     * pour la même raison — une valeur refusée ici donne un message lisible,
     * la même valeur laissée passer donne une erreur MySQL au moment de
     * l'écriture, quatre appels plus loin, sans dire laquelle.
     *
     * @param  array<string,mixed> $data
     * @return array<string,mixed>
     */
    private function validatedChallenge(array $data): array
    {
        if (array_key_exists('challenge_metric', $data)) {
            $metric = (string) ($data['challenge_metric'] ?? '');

            if ($metric !== '' && !in_array($metric, self::CHALLENGE_METRICS, true)) {
                throw new RuntimeException(sprintf(
                    'Critère de classement inconnu : attendu %s.',
                    implode(', ', self::CHALLENGE_METRICS)
                ));
            }

            $data['challenge_metric'] = $metric === '' ? null : $metric;
        }

        // Le seuil s'exprime en pourcentage de l'objectif de la boutique. Un
        // seuil au-delà de 999,99 % ne tiendrait pas dans DECIMAL(5,2), et un
        // seuil négatif n'a pas de sens : on est déjà au-dessus avant de
        // commencer.
        if (array_key_exists('challenge_trigger_pct', $data)) {
            $trigger = $data['challenge_trigger_pct'];

            if ($trigger === '' || $trigger === null) {
                $data['challenge_trigger_pct'] = null;
            } elseif ((float) $trigger < 0 || (float) $trigger > 999.99) {
                throw new RuntimeException('Le seuil de participation doit rester entre 0 et 999,99 %.');
            }
        }

        return $data;
    }

    /**
     * Marque de rattachement d'une campagne.
     *
     * Dans l'ordre : celle transmise par l'appelant, puis celle des boutiques
     * qu'il exploite — un franchisé n'en a qu'une —, puis l'unique marque
     * active du réseau. Si plusieurs marques sont actives et qu'aucune n'est
     * désignée, on refuse plutôt que d'en choisir une au hasard : rattacher une
     * campagne à la mauvaise enseigne ne se voit pas tout de suite.
     */
    private function resolveBrandId(AuthContext $auth, mixed $given): int
    {
        if ($given !== null && $given !== '' && (int) $given > 0) {
            return (int) $given;
        }

        $connection = Database::connection();
        $shopIds    = Scope::shopIds($auth);

        if ($shopIds !== null && $shopIds !== []) {
            [$placeholders, $bindings] = Database::inClause($shopIds, 'brand_shop');
            $statement = $connection->prepare(sprintf(
                'SELECT DISTINCT brand_id FROM mar_shop WHERE id IN (%s)',
                $placeholders
            ));
            $statement->execute($bindings);

            $brands = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
            if (count($brands) === 1) {
                return $brands[0];
            }
        }

        $brands = array_map(
            'intval',
            $connection->query('SELECT id FROM mar_brand WHERE is_active = 1')->fetchAll(PDO::FETCH_COLUMN)
        );

        if (count($brands) === 1) {
            return $brands[0];
        }

        throw new RuntimeException(
            $brands === []
                ? 'Aucune marque active : impossible de rattacher la campagne.'
                : 'Plusieurs marques actives : choisissez-en une dans le sélecteur de marque.'
        );
    }

    /**
     * Création complète, telle que l'assistant en sept étapes la produit.
     *
     * Une campagne n'est pas qu'une ligne : elle porte ses boutiques, ses
     * canaux de diffusion et ses objectifs par levier. Les écrire séparément
     * laisserait, à la première erreur, une campagne à moitié montée —
     * visible, budgétée, mais sans périmètre ni canal. D'où la transaction.
     *
     * @param  array<string,mixed> $data  Champs de campagne, plus les clés
     *                                    `shop_ids`, `channels`, `lever_targets`.
     * @throws RuntimeException si une boutique est hors périmètre.
     */
    public function createWithRelations(AuthContext $auth, array $data): int
    {
        $this->assertShopsInScope($auth, self::intList($data['shop_ids'] ?? []));

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $campaignId = $this->create($auth, $data);
            $this->writeRelations($campaignId, $auth, $data);

            $connection->commit();

            return $campaignId;
        } catch (\Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }
    }

    /**
     * Reprise d'un brouillon : la campagne et tous ses rattachements.
     *
     * Une campagne en brouillon est une campagne qu'on n'a pas fini d'écrire.
     * Jusqu'ici elle ne pouvait pas l'être : `update()` ne touche que les
     * colonnes de `mar_campaign`, et l'assistant écrivait ses rattachements à
     * la seule création. Un brouillon était donc un cul-de-sac — visible dans
     * la liste, impossible à terminer.
     *
     * Les rattachements sont remplacés, pas fusionnés. Les ajouter aux
     * précédents laisserait les canaux de la version d'avant à côté des
     * nouveaux : les budgets doubleraient sans que rien ne le signale.
     *
     * Réservée au brouillon. Une campagne lancée porte des choses que
     * l'assistant ne connaît pas — l'adhésion d'un franchisé, le budget local
     * qu'il a posé, un jalon déjà coché — et les reconstruire à neuf les
     * effacerait. Pour celles-là, `update()` et ses colonnes suffisent.
     */
    public function updateWithRelations(AuthContext $auth, int $id, array $data): bool
    {
        $current = $this->find($auth, $id);
        if ($current === null) {
            return false;
        }

        $this->assertWritable($auth, $current);

        if (($current['status_code'] ?? '') !== 'draft') {
            throw new RuntimeException(
                'Cette campagne n\'est plus un brouillon : son contenu ne se réécrit plus en bloc.'
            );
        }

        $this->assertShopsInScope($auth, self::intList($data['shop_ids'] ?? []));

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $this->updateColumns($auth, $id, $current, $data);
            $this->clearRelations($id);
            $this->writeRelations($id, $auth, $data);

            $connection->commit();

            return true;
        } catch (\Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }
    }

    /**
     * Boutiques hors périmètre : on refuse avant d'ouvrir la transaction.
     *
     * Inutile d'écrire quoi que ce soit pour l'annuler ensuite.
     *
     * @param list<int> $shopIds
     */
    private function assertShopsInScope(AuthContext $auth, array $shopIds): void
    {
        foreach ($shopIds as $shopId) {
            if (!Scope::allowsShop($auth, $shopId)) {
                throw new RuntimeException('Boutique hors périmètre : ' . $shopId);
            }
        }
    }

    /**
     * Efface les rattachements d'une campagne.
     *
     * Ordre indifférent : chaque table porte une clé étrangère en cascade vers
     * la campagne, et aucune ne dépend d'une autre — sauf les éléments d'offre,
     * emportés par la suppression de l'offre, et les déclinaisons, emportées
     * par celle du visuel.
     */
    private function clearRelations(int $campaignId): void
    {
        $connection = Database::connection();

        foreach ([
            'mar_campaign_shop',
            'mar_campaign_channel',
            'mar_campaign_lever_target',
            'mar_campaign_b2b_sector',
            'mar_campaign_agency_ask',
            'mar_campaign_b2b_option',
            'mar_campaign_uniform',
            'mar_campaign_pos_question',
            'mar_campaign_challenge_prize',
            'mar_retroplanning_step',
            'mar_campaign_offer',
            'mar_campaign_asset',
        ] as $table) {
            $statement = $connection->prepare(
                sprintf('DELETE FROM %s WHERE campaign_id = :id', $table)
            );
            $statement->execute(['id' => $campaignId]);
        }
    }

    /**
     * Rattachements d'une campagne, écrits à neuf.
     *
     * Partagé par la création et la reprise : deux copies de ces insertions
     * auraient divergé au premier champ ajouté, et c'est l'écran de reprise qui
     * aurait silencieusement perdu ce que la création savait écrire.
     *
     * @param array<string,mixed> $data
     */
    private function writeRelations(int $campaignId, AuthContext $auth, array $data): void
    {
        $connection = Database::connection();

        $shopIds  = self::intList($data['shop_ids'] ?? []);
        $channels = is_array($data['channels'] ?? null) ? $data['channels'] : [];
        $targets  = is_array($data['lever_targets'] ?? null) ? $data['lever_targets'] : [];
        $sectors  = self::intList($data['sector_ids'] ?? []);
        $asks     = self::intList($data['agency_ask_ids'] ?? []);
        $b2bOpts  = self::intList($data['b2b_option_ids'] ?? []);
        $uniforms = self::intList($data['uniform_ids'] ?? []);
        $formats  = self::intList($data['format_ids'] ?? []);
        $retro    = is_array($data['retroplanning'] ?? null) ? $data['retroplanning'] : [];
        $questions = is_array($data['pos_questions'] ?? null) ? $data['pos_questions'] : [];
        $offer    = is_array($data['offer'] ?? null) ? $data['offer'] : null;

        // Objectifs de pièces par boutique (étape « Objectifs »). Une boutique
        // objectivée participe de fait : une campagne réseau écrit donc aussi
        // ses rattachements, uniquement pour porter les objectifs.
        $targetsByShop  = [];
        $triggersByShop = [];
        foreach (is_array($data['shop_targets'] ?? null) ? $data['shop_targets'] : [] as $target) {
            $shopId = (int) ($target['shop_id'] ?? 0);
            $pieces = (int) ($target['target_pieces'] ?? 0);
            if ($shopId > 0 && $pieces > 0) {
                $targetsByShop[$shopId] = $pieces;
            }

            // Seuil propre à la boutique. Absent ou vide, il reste NULL : la
            // boutique suit alors le seuil général, et c'est bien un NULL qu'il
            // faut écrire — un zéro voudrait dire « qualifiée d'office ».
            $trigger = $target['challenge_trigger_pct'] ?? null;
            if ($shopId > 0 && $trigger !== null && $trigger !== '') {
                $triggersByShop[$shopId] = min(999.99, max(0, (float) $trigger));
            }
        }

        $shopRows = array_values(array_unique(
            [...$shopIds, ...array_keys($targetsByShop), ...array_keys($triggersByShop)]
        ));

        if ($shopRows !== []) {
            $statement = $connection->prepare(
                'INSERT INTO mar_campaign_shop
                    (campaign_id, shop_id, target_pieces, challenge_trigger_pct, created_by)
                 VALUES (:campaign_id, :shop_id, :target_pieces, :challenge_trigger_pct, :created_by)'
            );
            foreach ($shopRows as $shopId) {
                $statement->execute([
                    'campaign_id'           => $campaignId,
                    'shop_id'               => $shopId,
                    'target_pieces'         => $targetsByShop[$shopId] ?? null,
                    'challenge_trigger_pct' => $triggersByShop[$shopId] ?? null,
                    'created_by'            => $auth->userId,
                ]);
            }
        }

        // Prix du challenge. Le rang vient de la position dans la liste et non
        // d'un champ transmis : deux prix au même rang violeraient la clé
        // unique, et laisser le client décider du rang l'exposerait à ce
        // conflit sans qu'il puisse le prévoir.
        $prizes = is_array($data['challenge_prizes'] ?? null) ? $data['challenge_prizes'] : [];
        $rank   = 0;
        $insert = $connection->prepare(
            'INSERT INTO mar_campaign_challenge_prize
                (campaign_id, rank_position, label, created_by)
             VALUES (:campaign_id, :rank_position, :label, :created_by)'
        );

        foreach ($prizes as $prize) {
            $label = trim((string) (is_array($prize) ? ($prize['label'] ?? '') : $prize));
            $rank++;

            // Un rang sans dotation reste un rang : le deuxième prix vide ne
            // fait pas remonter le troisième à sa place.
            if ($label === '') {
                continue;
            }

            $insert->execute([
                'campaign_id'   => $campaignId,
                'rank_position' => $rank,
                'label'         => mb_substr($label, 0, 120),
                'created_by'    => $auth->userId,
            ]);
        }

        if ($channels !== []) {
            $statement = $connection->prepare(
                'INSERT INTO mar_campaign_channel
                    (campaign_id, channel_id, agency_id, budget_amount, is_enabled, created_by)
                 VALUES (:campaign_id, :channel_id, :agency_id, :budget_amount, 1, :created_by)'
            );
            foreach ($channels as $channel) {
                $channelId = (int) ($channel['channel_id'] ?? 0);
                if ($channelId === 0) {
                    continue;
                }

                // `budget_amount` est NOT NULL DEFAULT 0. Activer un canal
                // sans lui donner de budget est légitime — le montant se
                // décide plus tard — et doit valoir zéro, pas une 500.
                $budget = $channel['budget_amount'] ?? null;

                $statement->execute([
                    'campaign_id'   => $campaignId,
                    'channel_id'    => $channelId,
                    'agency_id'     => isset($channel['agency_id']) && $channel['agency_id'] !== ''
                        ? (int) $channel['agency_id']
                        : null,
                    'budget_amount' => $budget === null || $budget === '' ? 0 : $budget,
                    'created_by'    => $auth->userId,
                ]);
            }
        }

        if ($targets !== []) {
            $statement = $connection->prepare(
                'INSERT INTO mar_campaign_lever_target
                    (campaign_id, lever_id, target_value, target_unit, created_by)
                 VALUES (:campaign_id, :lever_id, :target_value, :target_unit, :created_by)'
            );
            foreach ($targets as $target) {
                $leverId = (int) ($target['lever_id'] ?? 0);
                if ($leverId === 0) {
                    continue;
                }

                $statement->execute([
                    'campaign_id'  => $campaignId,
                    'lever_id'     => $leverId,
                    'target_value' => $target['target_value'] ?? 0,
                    'target_unit'  => $target['target_unit'] ?? null,
                    'created_by'   => $auth->userId,
                ]);
            }
        }

        // Jonctions simples : même forme, même garde. Les identifiants sont
        // déjà filtrés par intList, et les clés étrangères refusent le reste.
        foreach ([
            ['mar_campaign_b2b_sector',    'sector_id', $sectors],
            ['mar_campaign_agency_ask',    'ask_id',    $asks],
            ['mar_campaign_b2b_option',    'option_id', $b2bOpts],
            ['mar_campaign_uniform',       'uniform_id', $uniforms],
        ] as [$table, $column, $ids]) {
            if ($ids === []) {
                continue;
            }

            $statement = $connection->prepare(sprintf(
                'INSERT INTO %s (campaign_id, %s) VALUES (:campaign_id, :value)',
                $table,
                $column
            ));
            foreach ($ids as $id) {
                $statement->execute(['campaign_id' => $campaignId, 'value' => $id]);
            }
        }

        $this->insertOffer($campaignId, $auth, $offer);
        $this->insertRetroplanning($campaignId, $auth, $retro);
        $this->insertPosQuestions($campaignId, $auth, $questions, !empty($data['pos_survey_enabled']));
        $this->insertAsset(
            $campaignId,
            $auth,
            $data['image_url'] ?? null,
            $data['focal_point_y'] ?? null,
            $data['image_fit'] ?? null,
            $formats
        );
    }

    /**
     * Offre rattachée à la campagne, avec ses éléments.
     *
     * La fenêtre de l'offre est distincte de la période de campagne : une
     * promotion peut ne courir que sur une partie de l'opération, et les deux
     * dates se comparent — d'où deux couples de colonnes et non un seul.
     *
     * @param array<string,mixed>|null $offer
     */
    private function insertOffer(int $campaignId, AuthContext $auth, ?array $offer): void
    {
        if ($offer === null || ($offer['title'] ?? '') === '') {
            return;
        }

        $connection = Database::connection();
        $statement  = $connection->prepare(
            'INSERT INTO mar_campaign_offer
                (campaign_id, template_id, title, mechanic_text, starts_on, ends_on,
                 hour_from, hour_to, max_qty_per_ticket, is_cumulative, created_by)
             VALUES
                (:campaign_id, :template_id, :title, :mechanic_text, :starts_on, :ends_on,
                 :hour_from, :hour_to, :max_qty_per_ticket, :is_cumulative, :created_by)'
        );

        // « Toute la journée » n'est pas une plage 00:00–23:59 : c'est l'absence
        // de contrainte horaire. On l'écrit NULL pour que les deux cas restent
        // distinguables à la lecture.
        $allDay = !empty($offer['all_day']);

        $statement->execute([
            'campaign_id'   => $campaignId,
            'template_id'   => ($offer['template_id'] ?? null) ?: null,
            'title'         => $offer['title'],
            'mechanic_text' => $offer['mechanic_text'] ?? null,
            'starts_on'     => ($offer['starts_on'] ?? null) ?: null,
            'ends_on'       => ($offer['ends_on'] ?? null) ?: null,
            'hour_from'     => $allDay ? null : (($offer['hour_from'] ?? null) ?: null),
            'hour_to'       => $allDay ? null : (($offer['hour_to'] ?? null) ?: null),
            // Un plafond vide n'est pas un plafond à zéro : NULL veut dire
            // « sans limite », 0 voudrait dire « aucune pièce en promotion ».
            'max_qty_per_ticket' => ($offer['max_qty_per_ticket'] ?? '') === '' || ($offer['max_qty_per_ticket'] ?? null) === null
                ? null
                : max(0, (int) $offer['max_qty_per_ticket']),
            'is_cumulative' => !empty($offer['is_cumulative']) ? 1 : 0,
            'created_by'    => $auth->userId,
        ]);

        $offerId = (int) $connection->lastInsertId();
        $items   = is_array($offer['items'] ?? null) ? $offer['items'] : [];

        if ($items === []) {
            return;
        }

        // Un rattachement ne vaut que vers une référence de catalogue qui
        // existe : un identifiant périmé — référence retirée entre la saisie
        // et l'envoi — retombe sur le libellé seul plutôt que de faire échouer
        // la campagne entière sur une clé étrangère.
        $wanted = [];
        foreach ($items as $item) {
            if (is_array($item) && (int) ($item['offer_item_id'] ?? 0) > 0) {
                $wanted[] = (int) $item['offer_item_id'];
            }
        }

        $knownIds = [];
        if ($wanted !== []) {
            $placeholders = implode(',', array_fill(0, count($wanted), '?'));
            $lookup = $connection->prepare(
                "SELECT id FROM mar_offer_item WHERE id IN ($placeholders)"
            );
            $lookup->execute($wanted);
            $knownIds = array_map('intval', $lookup->fetchAll(PDO::FETCH_COLUMN));
        }

        $statement = $connection->prepare(
            'INSERT INTO mar_campaign_offer_item
                (campaign_offer_id, offer_item_id, label, sort_order,
                 mechanic_type, discount_pct, fixed_price, buy_qty, get_qty,
                 baseline_price, margin_pct, target_pieces)
             VALUES
                (:offer_id, :offer_item_id, :label, :sort_order,
                 :mechanic_type, :discount_pct, :fixed_price, :buy_qty, :get_qty,
                 :baseline_price, :margin_pct, :target_pieces)'
        );

        $order = 0;
        foreach ($items as $item) {
            // Deux formes acceptées : la chaîne libre historique, et l'élément
            // choisi au catalogue — un libellé accompagné de sa référence.
            $label  = trim((string) (is_array($item) ? ($item['label'] ?? '') : $item));
            $itemId = is_array($item) ? (int) ($item['offer_item_id'] ?? 0) : 0;

            if ($label === '') {
                continue;
            }

            $pricing = $this->pricingOf(is_array($item) ? $item : []);

            $statement->execute([
                'offer_id'      => $offerId,
                'offer_item_id' => in_array($itemId, $knownIds, true) ? $itemId : null,
                'label'         => $label,
                'sort_order'    => ++$order,
            ] + $pricing);
        }
    }

    /**
     * Jalons du rétroplanning, comptés en jours avant le lancement.
     *
     * @param list<array<string,mixed>> $steps
     */
    private function insertRetroplanning(int $campaignId, AuthContext $auth, array $steps): void
    {
        if ($steps === []) {
            return;
        }

        $statement = Database::connection()->prepare(
            'INSERT INTO mar_retroplanning_step
                (campaign_id, label, days_before_launch, position_id, sort_order, created_by)
             VALUES (:campaign_id, :label, :days, :position_id, :sort_order, :created_by)'
        );

        $order = 0;
        foreach ($steps as $step) {
            $label = trim((string) ($step['label'] ?? ''));
            if ($label === '') {
                continue;
            }

            $statement->execute([
                'campaign_id' => $campaignId,
                'label'       => $label,
                'days'        => (int) ($step['days_before_launch'] ?? 0),
                'position_id' => ($step['position_id'] ?? null) ?: null,
                'sort_order'  => ++$order,
                'created_by'  => $auth->userId,
            ]);
        }
    }

    /**
     * Questions posées en caisse.
     *
     * Écrites seulement si le questionnaire est activé : garder les questions
     * d'un questionnaire décoché laisserait la caisse en poser que personne
     * n'a validées.
     *
     * @param list<array<string,mixed>> $questions
     */
    private function insertPosQuestions(
        int $campaignId,
        AuthContext $auth,
        array $questions,
        bool $enabled
    ): void {
        if (!$enabled || $questions === []) {
            return;
        }

        $known = Database::connection()
            ->query('SELECT code FROM mar_pos_answer_type')
            ->fetchAll(PDO::FETCH_COLUMN);

        $statement = Database::connection()->prepare(
            'INSERT INTO mar_campaign_pos_question
                (campaign_id, label, answer_type, options, is_required, sort_order, created_by)
             VALUES (:campaign_id, :label, :answer_type, :options, :is_required, :sort_order, :created_by)'
        );

        $order = 0;
        foreach ($questions as $question) {
            $label = trim((string) ($question['label'] ?? ''));
            if ($label === '') {
                continue;
            }

            $type = (string) ($question['answer_type'] ?? 'yes_no');
            if (!in_array($type, $known, true)) {
                throw new RuntimeException(sprintf(
                    'Forme de réponse inconnue : attendu %s.',
                    implode(', ', $known)
                ));
            }

            $options = trim((string) ($question['options'] ?? ''));

            $statement->execute([
                'campaign_id' => $campaignId,
                'label'       => mb_substr($label, 0, 300),
                'answer_type' => $type,
                // Les propositions n'ont de sens que pour un choix : les garder
                // ailleurs ferait croire à une liste que la caisse n'affichera
                // jamais.
                'options'     => $type === 'choice' && $options !== '' ? $options : null,
                'is_required' => !empty($question['is_required']) ? 1 : 0,
                'sort_order'  => ++$order,
                'created_by'  => $auth->userId ?: null,
            ]);
        }
    }

    /**
     * Visuel maître et déclinaisons à produire.
     *
     * Les rendus partent en `pending` : rien n'est fabriqué à la création. La
     * ligne dit qu'un format est attendu, pas qu'il existe — c'est ce qui
     * permet à l'écran « Pub digitale » d'afficher un reste à produire.
     *
     * @param list<int> $formatIds
     */
    private function insertAsset(
        int $campaignId,
        AuthContext $auth,
        mixed $imageUrl,
        mixed $focalPointY,
        mixed $fit,
        array $formatIds
    ): void {
        $imageUrl = is_string($imageUrl) ? trim($imageUrl) : '';
        if ($imageUrl === '' || $formatIds === []) {
            return;
        }

        $connection = Database::connection();
        $statement  = $connection->prepare(
            'INSERT INTO mar_campaign_asset (campaign_id, file_url, focal_point_y, fit, is_master, created_by)
             VALUES (:campaign_id, :file_url, :focal_point_y, :fit, 1, :created_by)'
        );
        $statement->execute([
            'campaign_id'   => $campaignId,
            'file_url'      => $imageUrl,
            'focal_point_y' => $focalPointY === null || $focalPointY === '' ? null : (float) $focalPointY,
            // Toute autre valeur retombe sur « cover » : c'est le cadrage
            // d'origine, celui de tous les visuels déjà enregistrés.
            'fit'           => $fit === 'contain' ? 'contain' : 'cover',
            'created_by'    => $auth->userId,
        ]);

        $assetId   = (int) $connection->lastInsertId();
        $statement = $connection->prepare(
            'INSERT INTO mar_asset_render (campaign_asset_id, format_id, status)
             VALUES (:asset_id, :format_id, \'pending\')'
        );

        foreach ($formatIds as $formatId) {
            $statement->execute(['asset_id' => $assetId, 'format_id' => $formatId]);
        }
    }

    /**
     * @param  mixed $values
     * @return list<int>
     */
    private static function intList(mixed $values): array
    {
        if (!is_array($values)) {
            return [];
        }

        $ints = array_map('intval', $values);

        return array_values(array_unique(array_filter($ints, static fn (int $v): bool => $v > 0)));
    }

    /** @param array<string,mixed> $data */
    public function update(AuthContext $auth, int $id, array $data): bool
    {
        $current = $this->find($auth, $id);
        if ($current === null) {
            return false;
        }

        $this->assertWritable($auth, $current);

        return $this->updateColumns($auth, $id, $current, $data);
    }

    /**
     * Colonnes de `mar_campaign`, validées puis écrites.
     *
     * Extrait d'`update()` pour que la reprise d'un brouillon en dispose sans
     * refaire les contrôles de périmètre : elle les a déjà passés, et les
     * refaire l'obligerait à relire la campagne une seconde fois.
     *
     * @param array<string,mixed> $current
     * @param array<string,mixed> $data
     */
    private function updateColumns(AuthContext $auth, int $id, array $current, array $data): bool
    {
        // Les mêmes contrôles qu'à la création. Ils n'y étaient pas : une
        // campagne créée valide pouvait ensuite recevoir une portée inconnue,
        // une période inversée ou une cible fantaisiste. Le cas de la portée
        // était le plus sournois — une valeur hors « RESEAU » / « LOCALE » fait
        // sortir la campagne du filtre de périmètre, donc de la vue de tout le
        // monde, sans qu'aucune erreur ne soit levée nulle part.
        $data = $this->validated($auth, $data + [
            'scope'         => $current['scope'],
            'client_target' => $current['client_target'],
            'status_code'   => $current['status_code'],
            'starts_on'     => $current['starts_on'],
            'ends_on'       => $current['ends_on'],
        ]);

        $columns = [
            'type_id', 'name', 'scope', 'client_target', 'tone', 'status_code', 'draft_step',
            'starts_on', 'ends_on', 'budget_amount', 'objective_coef_pct', 'agency_note',
            'b2b_webshop_enabled', 'pos_survey_enabled', 'spent_amount', 'approval_status',
            'create_crm_leads', 'image_url',
            'challenge_enabled', 'challenge_metric', 'challenge_trigger_pct',
            'margin_pct_default',
        ];

        // Colonnes TINYINT. PDO lie un `false` PHP comme chaîne vide, que MySQL
        // en mode strict refuse : « Incorrect integer value: '' ». La création
        // les normalisait déjà, la mise à jour non — le défaut ne se voyait pas
        // tant que personne n'envoyait un booléen à cette route.
        $flags = [
            'b2b_webshop_enabled', 'pos_survey_enabled', 'create_crm_leads', 'challenge_enabled',
        ];

        $assignments = [];
        $bindings    = ['id' => $id];

        foreach ($columns as $column) {
            if (array_key_exists($column, $data)) {
                $assignments[]     = sprintf('%1$s = :%1$s', $column);
                $bindings[$column] = in_array($column, $flags, true)
                    ? (empty($data[$column]) ? 0 : 1)
                    : $data[$column];
            }
        }

        if ($assignments === []) {
            return true;
        }

        $statement = Database::connection()->prepare(
            sprintf('UPDATE mar_campaign SET %s WHERE id = :id', implode(', ', $assignments))
        );

        return $statement->execute($bindings);
    }

    /**
     * Brouillon relu dans la forme que l'assistant sait remplir.
     *
     * `find()` sert le suivi et le brief : il rend des libellés — « Horeca »,
     * « Jeu concours » — parce qu'on les lit. L'assistant, lui, a besoin des
     * identifiants pour recocher les pastilles. Deux besoins, deux lectures :
     * faire rendre les deux à `find()` alourdirait chaque ouverture de suivi
     * pour un écran qui ne s'ouvre qu'à la reprise.
     *
     * @return array<string,mixed>|null
     */
    public function draft(AuthContext $auth, int $id): ?array
    {
        $campaign = $this->find($auth, $id);
        if ($campaign === null) {
            return null;
        }

        $ids = fn (string $sql): array => array_map(
            'intval',
            $this->column($sql, $id)
        );

        $channels = Database::connection()->prepare(
            'SELECT channel_id, agency_id, budget_amount
               FROM mar_campaign_channel WHERE campaign_id = :id'
        );
        $channels->execute(['id' => $id]);

        // Une ligne compte dès qu'elle porte un objectif *ou* un seuil : une
        // boutique dont on a réglé le seuil sans encore poser d'objectif ne
        // doit pas voir son réglage disparaître à la reprise.
        $shopTargets = Database::connection()->prepare(
            'SELECT shop_id, target_pieces, challenge_trigger_pct
               FROM mar_campaign_shop
              WHERE campaign_id = :id
                AND (target_pieces IS NOT NULL OR challenge_trigger_pct IS NOT NULL)'
        );
        $shopTargets->execute(['id' => $id]);

        $prizes = Database::connection()->prepare(
            'SELECT rank_position, label FROM mar_campaign_challenge_prize
              WHERE campaign_id = :id ORDER BY rank_position'
        );
        $prizes->execute(['id' => $id]);

        $questions = Database::connection()->prepare(
            'SELECT label, answer_type, options, is_required
               FROM mar_campaign_pos_question WHERE campaign_id = :id ORDER BY sort_order'
        );
        $questions->execute(['id' => $id]);

        $formats = $ids(
            'SELECT ar.format_id FROM mar_asset_render ar
               JOIN mar_campaign_asset ca ON ca.id = ar.campaign_asset_id
              WHERE ca.campaign_id = :id'
        );

        $master = Database::connection()->prepare(
            'SELECT file_url, focal_point_y, fit FROM mar_campaign_asset
              WHERE campaign_id = :id ORDER BY is_master DESC, id LIMIT 1'
        );
        $master->execute(['id' => $id]);
        $asset = $master->fetch();

        return [
            'id'                 => (int) $campaign['id'],
            'name'               => $campaign['name'],
            'type_id'            => $campaign['type_id'],
            'scope'              => $campaign['scope'],
            'status_code'        => $campaign['status_code'],
            'draft_step'         => $campaign['draft_step'] ?? null,
            'starts_on'          => $campaign['starts_on'],
            'ends_on'            => $campaign['ends_on'],
            'tone'               => $campaign['tone'],
            'client_target'      => $campaign['client_target'],
            'budget_amount'      => $campaign['budget_amount'],
            'objective_coef_pct' => $campaign['objective_coef_pct'],
            'agency_note'        => $campaign['agency_note'],
            'b2b_webshop_enabled' => (bool) $campaign['b2b_webshop_enabled'],
            'pos_survey_enabled' => (bool) $campaign['pos_survey_enabled'],
            'create_crm_leads'   => (bool) $campaign['create_crm_leads'],
            'image_url'          => $asset === false ? '' : (string) $asset['file_url'],
            'focal_point_y'      => $asset === false ? 50 : (int) $asset['focal_point_y'],
            'image_fit'          => $asset === false ? 'cover' : (string) $asset['fit'],

            'shop_ids'       => $ids('SELECT shop_id FROM mar_campaign_shop WHERE campaign_id = :id'),
            'margin_pct_default'    => $campaign['margin_pct_default'],
            'challenge_enabled'     => (bool) $campaign['challenge_enabled'],
            'challenge_metric'      => $campaign['challenge_metric'],
            'challenge_trigger_pct' => $campaign['challenge_trigger_pct'],
            'challenge_prizes'      => array_map(
                static fn (array $row): array => [
                    'rank_position' => (int) $row['rank_position'],
                    'label'         => (string) $row['label'],
                ],
                $prizes->fetchAll()
            ),

            'shop_targets'   => array_map(
                static fn (array $row): array => [
                    'shop_id'               => (int) $row['shop_id'],
                    'target_pieces'         => (int) ($row['target_pieces'] ?? 0),
                    'challenge_trigger_pct' => $row['challenge_trigger_pct'],
                ],
                $shopTargets->fetchAll()
            ),
            'sector_ids'     => $ids('SELECT sector_id FROM mar_campaign_b2b_sector WHERE campaign_id = :id'),
            'agency_ask_ids' => $ids('SELECT ask_id FROM mar_campaign_agency_ask WHERE campaign_id = :id'),
            'b2b_option_ids' => $ids('SELECT option_id FROM mar_campaign_b2b_option WHERE campaign_id = :id'),
            'uniform_ids'    => $ids('SELECT uniform_id FROM mar_campaign_uniform WHERE campaign_id = :id'),
            'format_ids'     => array_values(array_unique($formats)),

            'channels'      => array_map([$this, 'castRow'], $channels->fetchAll()),
            'lever_targets' => $this->leverTargets($id),
            'retroplanning' => $this->retroplanning($id),
            'pos_questions' => array_map([$this, 'castRow'], $questions->fetchAll()),
            'offer'         => $this->offer($id),
        ];
    }

    /**
     * Première colonne d'une requête paramétrée par la campagne.
     *
     * @return list<string>
     */
    private function column(string $sql, int $campaignId): array
    {
        $statement = Database::connection()->prepare($sql);
        $statement->execute(['id' => $campaignId]);

        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    public function delete(AuthContext $auth, int $id): bool
    {
        $current = $this->find($auth, $id);
        if ($current !== null) {
            $this->assertWritable($auth, $current);
        }

        if ($this->find($auth, $id) === null) {
            return false;
        }

        $statement = Database::connection()->prepare('DELETE FROM mar_campaign WHERE id = :id');

        return $statement->execute(['id' => $id]);
    }

    /** Libellé d'une valeur de référentiel, ou `null` si elle n'est pas posée. */
    private function labelOf(string $table, string $keyColumn, ?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $statement = Database::connection()->prepare(
            sprintf('SELECT label FROM %s WHERE %s = :value', $table, $keyColumn)
        );
        $statement->execute(['value' => $value]);

        $label = $statement->fetchColumn();

        return $label === false ? null : (string) $label;
    }

    /**
     * Libellés d'une table de jonction, en liste.
     *
     * @return list<string>
     */
    private function joined(string $sql, int $campaignId): array
    {
        $statement = Database::connection()->prepare($sql);
        $statement->execute(['id' => $campaignId]);

        return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    /** @return list<array<string,mixed>> */
    private function posQuestions(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT q.id, q.label, q.answer_type, q.options, q.is_required, q.sort_order,
                    t.label AS answer_type_label
               FROM mar_campaign_pos_question q
               LEFT JOIN mar_pos_answer_type t ON t.code = q.answer_type
              WHERE q.campaign_id = :id
              ORDER BY q.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        $rows = array_map([$this, 'castRow'], $statement->fetchAll());
        foreach ($rows as &$row) {
            $row['is_required'] = (bool) $row['is_required'];
        }

        return $rows;
    }

    /** @return list<array<string,mixed>> */
    private function campaignChannels(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT ch.label, ch.family, cc.budget_amount, cc.is_enabled, a.name AS agency_name
               FROM mar_campaign_channel cc
               JOIN mar_channel ch     ON ch.id = cc.channel_id
               LEFT JOIN mar_agency a  ON a.id = cc.agency_id
              WHERE cc.campaign_id = :id
              ORDER BY ch.family, ch.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        $rows = array_map([$this, 'castRow'], $statement->fetchAll());
        foreach ($rows as &$row) {
            $row['is_enabled'] = (bool) $row['is_enabled'];
        }

        return $rows;
    }

    /**
     * Visuel maître et déclinaisons attendues.
     *
     * @return list<array<string,mixed>>
     */
    private function assets(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT ca.id, ca.file_url, ca.focal_point_y, ca.fit, ca.is_master,
                    COUNT(ar.id)                                          AS renders_count,
                    SUM(CASE WHEN ar.status = \'pending\' THEN 1 ELSE 0 END) AS pending_count
               FROM mar_campaign_asset ca
               LEFT JOIN mar_asset_render ar ON ar.campaign_asset_id = ca.id
              WHERE ca.campaign_id = :id
              GROUP BY ca.id, ca.file_url, ca.focal_point_y, ca.fit, ca.is_master
              ORDER BY ca.is_master DESC, ca.id'
        );
        $statement->execute(['id' => $campaignId]);

        $rows = array_map([$this, 'castRow'], $statement->fetchAll());
        foreach ($rows as &$row) {
            $row['is_master']     = (bool) $row['is_master'];
            $row['renders_count'] = (int) $row['renders_count'];
            $row['pending_count'] = (int) $row['pending_count'];
        }

        return $rows;
    }

    /** @return list<array<string,mixed>> */
    private function shops(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT cs.shop_id, s.name AS shop_name, s.city, cs.opt_in_at, cs.local_budget_amount
               FROM mar_campaign_shop cs
               JOIN mar_shop s ON s.id = cs.shop_id
              WHERE cs.campaign_id = :id
              ORDER BY s.name'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return list<array<string,mixed>> */
    private function leverTargets(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT clt.lever_id, l.code, l.label, l.color_hex,
                    clt.target_value, clt.target_unit, clt.actual_value
               FROM mar_campaign_lever_target clt
               JOIN mar_lever l ON l.id = clt.lever_id
              WHERE clt.campaign_id = :id
              ORDER BY l.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return list<array<string,mixed>> */
    private function retroplanning(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT rs.id, rs.label, rs.days_before_launch, rs.position_id,
                    p.label AS position_label, rs.assignee_user_id, rs.done_at, rs.sort_order
               FROM mar_retroplanning_step rs
               LEFT JOIN mar_position p ON p.id = rs.position_id
              WHERE rs.campaign_id = :id
              ORDER BY rs.sort_order, rs.days_before_launch DESC'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /** @return array<string,mixed>|null */
    private function offer(int $campaignId): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT co.*, l.code AS lever_code, l.label AS lever_label, l.color_hex AS lever_color_hex,
                    v.code AS voucher_code
               FROM mar_campaign_offer co
               LEFT JOIN mar_lever l   ON l.id = co.lever_id
               LEFT JOIN mar_voucher v ON v.id = co.voucher_id
              WHERE co.campaign_id = :id
              ORDER BY co.id
              LIMIT 1'
        );
        $statement->execute(['id' => $campaignId]);

        $offer = $statement->fetch();
        if ($offer === false) {
            return null;
        }

        $items = Database::connection()->prepare(
            // La famille vient du catalogue et non du libellé : « Gamme
            // Épiphanie » est une saison, mais rien dans son texte ne
            // l'affirme, et un produit nommé « Gamme du chef » tromperait
            // n'importe quelle règle sur le préfixe.
            'SELECT ci.label, ci.offer_item_id, ci.sort_order,
                    ci.mechanic_type, ci.discount_pct, ci.fixed_price,
                    ci.buy_qty, ci.get_qty, ci.baseline_price, ci.margin_pct,
                    ci.target_pieces, oi.category
               FROM mar_campaign_offer_item ci
               LEFT JOIN mar_offer_item oi ON oi.id = ci.offer_item_id
              WHERE ci.campaign_offer_id = :id
              ORDER BY ci.sort_order'
        );
        $items->execute(['id' => (int) $offer['id']]);

        $offer          = $this->castRow($offer);
        // Colonne TINYINT : `castRow` en fait un entier, or le front la lit
        // comme un booléen. Un `1` marche par hasard ; `0` marcherait aussi,
        // et c'est précisément le genre de hasard qui casse un jour.
        $offer['is_cumulative'] = (bool) $offer['is_cumulative'];
        $offer['items'] = $items->fetchAll();

        return $offer;
    }

    /** @return list<array<string,mixed>> */
    private function sectors(int $campaignId): array
    {
        $statement = Database::connection()->prepare(
            'SELECT s.id, s.code, s.label, s.estimated_leads_count
               FROM mar_campaign_b2b_sector cbs
               JOIN mar_b2b_sector s ON s.id = cbs.sector_id
              WHERE cbs.campaign_id = :id
              ORDER BY s.sort_order'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map([$this, 'castRow'], $statement->fetchAll());
    }

    /**
     * PDO renvoie les DECIMAL en chaîne. On les convertit ici, une fois, pour que
     * le front reçoive des nombres et n'ait pas à deviner quelles colonnes parser.
     *
     * @param  array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function castRow(array $row): array
    {
        // Colonnes numériques dont le nom ne porte aucun suffixe exploitable.
        // `mar_campaign_kpi_snapshot.value` en fait partie : sans elle, un KPI
        // repartait en chaîne « 1284.00 » et s'affichait tel quel.
        static $numericColumns = ['value', 'amount', 'quantity', 'rate_pct', 'focal_point_y'];

        foreach ($row as $key => $value) {
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (
                in_array($key, $numericColumns, true)
                || str_ends_with($key, '_amount')
                || str_ends_with($key, '_pct')
                || str_ends_with($key, '_value')
            ) {
                $row[$key] = (float) $value;
            } elseif (str_ends_with($key, '_id') || str_ends_with($key, '_count') || $key === 'id') {
                $row[$key] = (int) $value;
            }
        }

        if (array_key_exists('create_crm_leads', $row)) {
            $row['create_crm_leads'] = (bool) $row['create_crm_leads'];
        }

        return $row;
    }
}
