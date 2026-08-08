<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Env;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Reprise des données de l'ERP : boutiques et comptes professionnels.
 *
 * Le module tenait jusqu'ici ses propres `mar_shop`, qu'il fallait saisir à la
 * main — d'où l'écran « Aucune boutique dans votre périmètre » alors que le
 * réseau en exploite plusieurs. Les boutiques réelles vivent dans l'ERP, et les
 * comptes professionnels sont ses clients marqués `is_b2b`.
 *
 * Les deux tables sont nommées en configuration — `franchisee_shop` et
 * `client` par défaut, dans la base du module. Leurs colonnes, en revanche, ne
 * sont pas supposées : elles sont découvertes dans `information_schema`, et la
 * reprise rapporte celles qu'elle a retenues. Une correspondance devinée qui
 * tombe juste par hasard est plus dangereuse qu'une erreur franche — elle
 * importe des données fausses sans prévenir.
 */
final class ErpSyncRepository
{
    /**
     * Colonnes rencontrées, par table, au fil de la résolution.
     *
     * @var array<string, array<string, list<string>>>
     */
    private array $inventory = [];

    /**
     * Colonnes candidates, par notion. La première trouvée l'emporte.
     *
     * Plusieurs noms par notion parce qu'un ERP francophone hésite entre
     * `zip`, `cp` et `postal_code` selon les tables, et qu'imposer un nom
     * unique reviendrait à demander une migration côté ERP pour lire ses
     * données.
     *
     * @var array<string, list<string>>
     */
    /**
     * Colonnes possibles d'une table de marques.
     *
     * @var array<string, list<string>>
     */
    private const BRAND_COLUMNS = [
        'id'   => ['id', 'id_brand', 'id_marque', 'id_enseigne', 'brand_id'],
        'name' => ['name', 'label', 'nom', 'libelle', 'brand', 'marque', 'enseigne'],
        'code' => ['code', 'slug', 'reference'],
    ];

    /** @var array<string, list<string>> */
    private const SHOP_COLUMNS = [
        // `id_franchisee_shop` / `id_shop` : cet ERP préfixe ses clés du nom de
        // la table, convention répandue et incompatible avec un simple `id`.
        'id'        => ['id', 'id_franchisee_shop', 'id_shop', 'shop_id'],
        // `representative_name` avant `name` : sur cette installation, `name`
        // porte la raison sociale du franchisé — « Berdiff s.a. » — là où le
        // nom d'usage de la boutique est dans `representative_name`. La liste
        // garde `name` en repli, pour les lignes où le premier est vide.
        'name'      => ['representative_name', 'name', 'label', 'shop_name', 'nom', 'libelle'],
        'fallback_name' => ['name', 'label', 'nom'],
        'code'      => ['code', 'slug', 'reference'],
        'city'      => ['city', 'ville', 'town'],
        'is_active' => ['is_active', 'active', 'enabled', 'actif'],
        // Facultative : un réseau mono-enseigne n'a pas de colonne de marque.
        'brand'     => ['id_brand', 'brand_id', 'id_marque', 'id_enseigne', 'brand', 'marque', 'enseigne'],
    ];

    /** @var array<string, list<string>> */
    private const CUSTOMER_COLUMNS = [
        'id'           => ['id', 'id_client', 'id_customer', 'customer_id'],
        'company_name' => ['company_name', 'company', 'raison_sociale', 'societe', 'name', 'nom'],
        // `name` / `surname` : sur cette installation, l'état civil du contact.
        // Ils passent après `company_name`, qui est résolu en premier et leur
        // laisse donc la place.
        'contact_name' => ['contact_name', 'contact', 'full_name', 'name', 'surname', 'firstname', 'prenom'],
        'email'        => ['email', 'mail', 'contact_email'],
        'phone'        => ['phone', 'tel', 'telephone', 'contact_phone', 'gsm'],
        'city'         => ['city', 'ville', 'town'],
        'postal_code'  => ['postal_code', 'zip', 'cp', 'zipcode', 'code_postal'],
        // Boutique de rattachement du client : `id_mainshop` sur cette
        // installation, d'où sa place en tête.
        // Boutique de rattachement. `id_main_shop` sur cette installation —
        // l'inventaire des colonnes l'a montré là où `id_mainshop`, essayé de
        // mémoire, ne trouvait rien et laissait 893 comptes sans boutique.
        'shop_id'      => ['id_main_shop', 'id_mainshop', 'preferred_shop_id', 'shop_id', 'id_shop', 'boutique_id', 'store_id'],
        // Le marqueur professionnel n'est pas forcément un booléen : sur cette
        // installation c'est `b2b_client_type`, un type de compte, où « être
        // B2B » signifie « en avoir un ». D'où un nom de notion neutre et un
        // test déduit du type réel de la colonne, plus bas.
        'b2b_flag'     => ['b2b_client_type', 'is_b2b', 'b2b', 'is_professional', 'professionnel'],
        // Un compte fermé ou bloqué ne se démarche pas : l'appel tomberait sur
        // une entreprise qui n'est plus cliente, ou qui l'est mal.
        'active'       => ['active', 'is_active', 'actif', 'enabled'],
        'blocked'      => ['blocked', 'is_blocked', 'bloque'],
    ];

    /**
     * Produits du catalogue ERP.
     *
     * `suggested_sale_price` en tête : c'est le prix que cette installation
     * porte sur ses produits, les autres noms sont des replis génériques.
     *
     * @var array<string, list<string>>
     */
    private const PRODUCT_COLUMNS = [
        'id'       => ['id', 'id_product', 'product_id'],
        'name'     => ['name', 'label', 'nom', 'libelle'],
        'category' => ['id_category', 'category_id', 'id_product_category'],
        'price'    => ['suggested_sale_price', 'price', 'price_amount', 'prix', 'sale_price'],
        'active'   => ['is_active', 'active', 'enabled', 'actif'],
    ];

    /**
     * Familles de produits, pour situer chaque référence dans le sélecteur.
     *
     * @var array<string, list<string>>
     */
    private const PRODUCT_CATEGORY_COLUMNS = [
        'id'   => ['id', 'id_category', 'id_product_category'],
        'name' => ['name', 'label', 'nom', 'libelle'],
    ];

    /**
     * Gammes saisonnières de l'ERP (`product_availability_period`).
     *
     * @var array<string, list<string>>
     */
    private const SEASON_COLUMNS = [
        'id'     => ['id', 'id_period', 'period_id'],
        'name'   => ['name', 'label', 'nom', 'libelle'],
        'active' => ['is_active', 'active', 'enabled', 'actif'],
    ];

    /**
     * Secteurs visés : les types de compte professionnel de l'ERP.
     *
     * @var array<string, list<string>>
     */
    private const SECTOR_COLUMNS = [
        'id'    => ['id', 'id_b2b_client_type', 'id_type'],
        'name'  => ['name', 'label', 'nom', 'libelle'],
        'brand' => ['id_brand', 'brand_id', 'id_marque', 'id_enseigne'],
    ];

    /**
     * Côté client de la table de liaison.
     *
     * `id_b2b_client` figure dans la liste parce que cette installation le
     * nomme ainsi, et qu'aucune table `b2b_client` n'existe pour lui donner un
     * autre sens. Ce n'est pas une déduction tirée du nom : la correspondance
     * réelle de ses valeurs est mesurée à chaque reprise et rapportée, de sorte
     * qu'une colonne qui désignerait autre chose se signale d'elle-même au lieu
     * de rattacher en silence.
     *
     * @var list<string>
     */
    private const LINK_CLIENT_COLUMNS = [
        'id_client', 'client_id', 'id_b2b_client', 'b2b_client_id', 'id_customer', 'customer_id',
    ];

    /**
     * Côté secteur de la table de liaison.
     *
     * Les noms explicites d'abord. `id_interest` ferme la liste : sur cette
     * installation, c'est lui qui porte le type de compte, mais le nom seul
     * laisserait croire à un centre d'intérêt — d'où sa dernière place, et la
     * mesure qui l'accompagne.
     *
     * @var list<string>
     */
    private const LINK_SECTOR_COLUMNS = [
        'id_b2b_client_type', 'b2b_client_type_id', 'id_type', 'type_id',
        'id_sector', 'sector_id', 'id_interest', 'interest_id',
    ];

    /**
     * Synchronise boutiques et comptes B2B.
     *
     * @return array<string, mixed>
     */
    public function sync(AuthContext $auth, int $brandId): array
    {
        $result = [
            'shops'     => $this->syncShops($auth, $brandId),
            'prospects' => $this->syncProspects($auth, $brandId),
        ];

        // Les secteurs viennent en dernier : ils ont besoin des deux précédents
        // — les comptes pour savoir qui rattacher, les boutiques pour savoir
        // qui appellera. Leur échec ne remet pas en cause ce qui est déjà en
        // base : les boutiques et le vivier sont repris et validés, et ce sont
        // eux dont dépendent tous les écrans hors choix des secteurs.
        try {
            $result['sectors'] = $this->syncSectors($brandId);
            $result['links']   = $this->syncProspectSectors($brandId);
        } catch (Throwable $failure) {
            $result['links'] = ['error' => $failure->getMessage()];
        }

        // Le catalogue vient en marge : son échec ne remet pas en cause la
        // reprise des boutiques et du vivier, qui portent tous les écrans B2B.
        try {
            $result['products'] = $this->syncProducts($auth);
        } catch (Throwable $failure) {
            $result['products'] = ['error' => $failure->getMessage()];
        }

        // Les gammes saisonnières habillent l'étape « Offre » ; même marge que
        // le catalogue produit, et même indifférence à leur échec isolé.
        try {
            $result['seasons'] = $this->syncSeasons($auth);
        } catch (Throwable $failure) {
            $result['seasons'] = ['error' => $failure->getMessage()];
        }

        $result['inventory'] = $this->inventory;

        return $result;
    }

    /**
     * Produits de l'ERP → catalogue `mar_offer_item`.
     *
     * C'est cette reprise qui donne à l'étape « Offre » de l'assistant une
     * sélection de vraies références : sans elle, les éléments d'offre se
     * saisissent en clair, et `mar_campaign_offer_item.offer_item_id` reste
     * vide. Le rapprochement se fait sur `sku_ref` (« erp-<id> »), unique
     * depuis 020, pour que la reprise soit rejouable sans dupliquer.
     *
     * @return array<string, mixed>
     */
    public function syncProducts(AuthContext $auth): array
    {
        [$schema, $table] = $this->source('MAR_ERP_PRODUCTS_TABLE', 'product');
        $columns = $this->resolve($schema, $table, self::PRODUCT_COLUMNS, ['id', 'name']);

        // Un produit désactivé côté ERP ne se vend plus : il n'a rien à faire
        // dans une offre. Le filtre ne s'applique que si la colonne existe.
        $where = isset($columns['active'])
            ? sprintf('`%1$s` IS NULL OR `%1$s` <> 0', $columns['active'])
            : null;

        $rows = $this->readSource($schema, $table, $columns, $where);

        // Libellés des familles. Leur absence ne bloque pas : un produit sans
        // famille reste un produit — le sélecteur le montrera sans rubrique.
        $families = [];
        try {
            [$familySchema, $familyTable] = $this->source('MAR_ERP_PRODUCT_CATEGORIES_TABLE', 'product_category');
            $familyColumns = $this->resolve($familySchema, $familyTable, self::PRODUCT_CATEGORY_COLUMNS, ['id', 'name']);

            foreach ($this->readSource($familySchema, $familyTable, $familyColumns) as $family) {
                $families[(int) $family['id']] = trim((string) ($family['name'] ?? ''));
            }
        } catch (Throwable) {
            // Table de familles absente ou illisible : tant pis pour la rubrique.
        }

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $upsert = $connection->prepare(
                'INSERT INTO mar_offer_item
                    (category, sku_ref, name, detail, price_amount, is_active, created_by)
                 VALUES
                    (\'produit\', :sku_ref, :name, :detail, :price_amount, 1, :created_by)
                 ON DUPLICATE KEY UPDATE
                    name         = VALUES(name),
                    detail       = VALUES(detail),
                    price_amount = VALUES(price_amount),
                    is_active    = 1'
            );

            $created = 0;
            $updated = 0;
            $skipped = 0;
            $seen    = [];

            foreach ($rows as $row) {
                $name = trim((string) ($row['name'] ?? ''));
                if ($name === '') {
                    $skipped++;
                    continue;
                }

                // La famille d'affichage est l'ancêtre au millier (11101 →
                // 11000 « Tartes ») : la catégorie feuille (« Tartissières -
                // 12Ø ») ferait autant de rubriques que de diamètres de tarte.
                $familyId  = isset($row['category']) ? (int) $row['category'] : 0;
                $groupName = trim((string) ($families[intdiv($familyId, 1000) * 1000] ?? ''));
                $family    = $groupName !== '' ? $groupName : trim((string) ($families[$familyId] ?? ''));
                $skuRef    = 'erp-' . $row['id'];

                $upsert->execute([
                    'sku_ref'      => $skuRef,
                    'name'         => mb_substr($name, 0, 200),
                    'detail'       => $family === '' ? null : mb_substr($family, 0, 400),
                    'price_amount' => isset($row['price']) && $row['price'] !== null && $row['price'] !== ''
                        ? (float) $row['price']
                        : null,
                    'created_by'   => $auth->userId ?: null,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
                $seen[] = $skuRef;
            }

            // Les références disparues de l'ERP sortent du sélecteur sans être
            // supprimées : les offres déjà montées dessus gardent leur libellé
            // et leur rattachement.
            $retired = 0;
            if ($seen !== []) {
                $placeholders = implode(',', array_fill(0, count($seen), '?'));
                $retire = $connection->prepare(
                    "UPDATE mar_offer_item SET is_active = 0
                      WHERE category = 'produit' AND sku_ref LIKE 'erp-%'
                        AND is_active = 1 AND sku_ref NOT IN ($placeholders)"
                );
                $retire->execute($seen);
                $retired = $retire->rowCount();
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        return [
            'source'  => $schema . '.' . $table,
            'columns' => $columns,
            'read'    => count($rows),
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'retired' => $retired,
        ];
    }

    /**
     * Gammes saisonnières de l'ERP → catalogue, en `category = 'saison'`.
     *
     * L'étape « Offre » les propose en tête de composition : une offre se
     * rattache d'abord à une gamme (« Estivale », « Noël »…) avant de lister
     * ses produits. Même mécanique rejouable que les produits, sur un
     * `sku_ref` distinct (« erp-saison-<id> ») pour que les deux familles ne
     * se marchent pas dessus.
     *
     * @return array<string, mixed>
     */
    public function syncSeasons(AuthContext $auth): array
    {
        [$schema, $table] = $this->source('MAR_ERP_SEASONS_TABLE', 'product_availability_period');
        $columns = $this->resolve($schema, $table, self::SEASON_COLUMNS, ['id', 'name']);

        $where = isset($columns['active'])
            ? sprintf('`%1$s` IS NULL OR `%1$s` <> 0', $columns['active'])
            : null;

        $rows = $this->readSource($schema, $table, $columns, $where);

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $upsert = $connection->prepare(
                'INSERT INTO mar_offer_item
                    (category, sku_ref, name, is_active, created_by)
                 VALUES
                    (\'saison\', :sku_ref, :name, 1, :created_by)
                 ON DUPLICATE KEY UPDATE
                    name      = VALUES(name),
                    is_active = 1'
            );

            $created = 0;
            $updated = 0;
            $skipped = 0;
            $seen    = [];

            foreach ($rows as $row) {
                $name = trim((string) ($row['name'] ?? ''));
                if ($name === '') {
                    $skipped++;
                    continue;
                }

                $skuRef = 'erp-saison-' . $row['id'];

                $upsert->execute([
                    'sku_ref'    => $skuRef,
                    'name'       => mb_substr($name, 0, 200),
                    'created_by' => $auth->userId ?: null,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
                $seen[] = $skuRef;
            }

            $retired = 0;
            if ($seen !== []) {
                $placeholders = implode(',', array_fill(0, count($seen), '?'));
                $retire = $connection->prepare(
                    "UPDATE mar_offer_item SET is_active = 0
                      WHERE category = 'saison' AND sku_ref LIKE 'erp-saison-%'
                        AND is_active = 1 AND sku_ref NOT IN ($placeholders)"
                );
                $retire->execute($seen);
                $retired = $retire->rowCount();
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        return [
            'source'  => $schema . '.' . $table,
            'columns' => $columns,
            'read'    => count($rows),
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'retired' => $retired,
        ];
    }

    /** @return array<string, array<string, list<string>>> */
    public function inventory(): array
    {
        return $this->inventory;
    }

    /**
     * Marques du réseau, reprises de l'ERP.
     *
     * Le module ne peut rien faire sans marque : une campagne s'y rattache, une
     * boutique en dépend. Elle ne s'invente pas pour autant — une enseigne est
     * un fait commercial, pas une valeur par défaut. On la lit donc là où elle
     * existe : soit une table de marques, soit la colonne d'enseigne portée par
     * les boutiques quand elle est textuelle.
     *
     * @return array<string, mixed>
     */
    public function syncBrands(AuthContext $auth): array
    {
        $schema = $this->currentSchema();

        [$table, $columns, $rows] = $this->readBrands($schema);

        $connection = Database::connection();
        $created    = 0;
        $updated    = 0;

        $upsert = $connection->prepare(
            'INSERT INTO mar_brand (code, name, created_by)
             VALUES (:code, :name, :created_by)
             ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1'
        );

        foreach ($rows as $row) {
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $upsert->execute([
                'code'       => $row['code'] ?? self::slug($name),
                'name'       => $name,
                'created_by' => $auth->userId ?: null,
            ]);

            $upsert->rowCount() === 1 ? $created++ : $updated++;
        }

        return [
            'source'  => $table === null ? '—' : $schema . '.' . $table,
            'columns' => $columns,
            'read'    => count($rows),
            'created' => $created,
            'updated' => $updated,
            'skipped' => 0,
        ];
    }

    /**
     * Marques lisibles, et d'où elles viennent.
     *
     * @return array{0:?string, 1:array<string,string>, 2:list<array<string,mixed>>}
     */
    private function readBrands(string $schema): array
    {
        $configured = trim((string) (Env::get('MAR_ERP_BRANDS_TABLE', '') ?: ''));

        if ($configured !== '') {
            [$brandSchema, $table] = $this->source('MAR_ERP_BRANDS_TABLE', $configured);
            $columns = $this->resolve($brandSchema, $table, self::BRAND_COLUMNS, ['name']);

            return [$table, $columns, $this->readSource($brandSchema, $table, $columns)];
        }

        // Table de marques dédiée, reconnue à son nom. Une seule candidate :
        // on la prend ; plusieurs : on refuse plutôt que de tirer au sort.
        $statement = Database::connection()->prepare(
            'SELECT table_name FROM information_schema.tables
              WHERE table_schema = :schema
                AND (table_name LIKE \'%brand%\' OR table_name LIKE \'%marque%\'
                     OR table_name LIKE \'%enseigne%\')
                AND table_name NOT LIKE \'mar\\_%\'
              ORDER BY table_name'
        );
        $statement->execute(['schema' => $schema]);
        $candidates = $statement->fetchAll(PDO::FETCH_COLUMN);

        if (count($candidates) === 1) {
            $table   = (string) $candidates[0];
            $columns = $this->resolve($schema, $table, self::BRAND_COLUMNS, ['name']);

            return [$table, $columns, $this->readSource($schema, $table, $columns)];
        }

        if (count($candidates) > 1) {
            throw new RuntimeException(sprintf(
                'Plusieurs tables ressemblent à une table de marques (%s). '
                . 'Renseignez MAR_ERP_BRANDS_TABLE pour trancher.',
                implode(', ', $candidates)
            ));
        }

        // À défaut, l'enseigne portée par les boutiques — utilisable seulement
        // si elle est écrite en clair. Une colonne d'identifiants ne donnerait
        // que des numéros, et une marque nommée « 3 » n'aide personne.
        [$shopSchema, $shopTable] = $this->source('MAR_ERP_SHOPS_TABLE', 'franchisee_shop');
        $shopColumns = $this->resolve($shopSchema, $shopTable, self::SHOP_COLUMNS, ['id', 'name']);

        if (isset($shopColumns['brand']) && !$this->isNumericColumn($shopSchema, $shopTable, $shopColumns['brand'])) {
            $rows = Database::connection()->query(sprintf(
                'SELECT DISTINCT `%s` AS `name` FROM `%s`.`%s` WHERE `%s` IS NOT NULL AND `%s` <> \'\'',
                $shopColumns['brand'],
                $shopSchema,
                $shopTable,
                $shopColumns['brand'],
                $shopColumns['brand']
            ))->fetchAll();

            return [$shopTable, ['name' => $shopColumns['brand']], $rows];
        }

        throw new RuntimeException(
            'Aucune marque trouvée dans l\'ERP : ni table de marques, ni colonne '
            . 'd\'enseigne exploitable sur les boutiques. Renseignez '
            . 'MAR_ERP_BRANDS_TABLE, ou créez la marque avec '
            . 'db/sync-erp.php --brand="Nom de l\'enseigne".'
        );
    }

    /** Vrai si la colonne stocke un nombre. */
    private function isNumericColumn(string $schema, string $table, string $column): bool
    {
        $statement = Database::connection()->prepare(
            'SELECT data_type FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table AND column_name = :column'
        );
        $statement->execute(['schema' => $schema, 'table' => $table, 'column' => $column]);

        return in_array(strtolower((string) $statement->fetchColumn()), [
            'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
            'decimal', 'numeric', 'float', 'double', 'bit',
        ], true);
    }

    /** Clé de tri alphabétique, accents repliés sur leur lettre de base. */
    private static function sortKey(string $name): string
    {
        return mb_strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $name) ?: $name);
    }

    /** Code de marque dérivé du nom, quand l'ERP n'en fournit pas. */
    private static function slug(string $name): string
    {
        $ascii = iconv('UTF-8', 'ASCII//TRANSLIT', $name) ?: $name;
        $slug  = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', $ascii));

        return trim($slug, '-') ?: 'marque';
    }

    /**
     * Boutiques de l'ERP → `mar_shop`.
     *
     * Le rapprochement se fait sur `erp_shop_id`, prévu pour cela dès le
     * schéma : reprendre le nom serait fragile — « Uccle » et « Uccle (Fort
     * Jaco) » désignent la même boutique renommée, et le rapprochement par nom
     * en créerait une seconde.
     *
     * @return array<string, mixed>
     */
    public function syncShops(AuthContext $auth, int $brandId): array
    {
        [$schema, $table] = $this->source('MAR_ERP_SHOPS_TABLE', 'franchisee_shop');
        $columns = $this->resolve($schema, $table, self::SHOP_COLUMNS, ['id', 'name']);

        $rows = $this->readSource($schema, $table, $columns);

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            // `erp_shop_id` figure dans la clause de mise à jour, et pas
            // seulement dans l'insertion. Deux clés uniques couvrent cette
            // table : l'identifiant ERP et le code. Quand c'est le code qui
            // entre en conflit — une boutique saisie à la main avant la
            // première reprise — la ligne restait sans identifiant ERP, donc
            // hors de portée du rattachement des comptes B2B, définitivement.
            $upsert = $connection->prepare(
                'INSERT INTO mar_shop (brand_id, erp_shop_id, code, name, city, created_by)
                 VALUES (:brand_id, :erp_shop_id, :code, :name, :city, :created_by)
                 ON DUPLICATE KEY UPDATE
                    erp_shop_id = VALUES(erp_shop_id),
                    name        = VALUES(name),
                    city        = VALUES(city),
                    code        = VALUES(code)'
            );

            $created = 0;
            $updated = 0;
            $skipped = 0;

            foreach ($rows as $row) {
                // Une boutique fermée dans l'ERP ne doit pas réapparaître dans
                // le sélecteur de périmètre d'une nouvelle campagne.
                if (array_key_exists('is_active', $row) && (int) $row['is_active'] === 0) {
                    $skipped++;
                    continue;
                }

                // Le nom d'usage, à défaut la raison sociale : une boutique
                // sans nom disparaîtrait du choix de périmètre, alors qu'elle
                // existe et vend.
                $name = trim((string) ($row['name'] ?? ''));
                if ($name === '') {
                    $name = trim((string) ($row['fallback_name'] ?? ''));
                }

                if ($name === '') {
                    $skipped++;
                    continue;
                }

                $upsert->execute([
                    'brand_id'    => $brandId,
                    'erp_shop_id' => (int) $row['id'],
                    // `code` est unique par marque : à défaut, l'identifiant
                    // ERP fait un code stable, ce qu'un nom n'est pas.
                    'code'        => mb_substr((string) ($row['code'] ?? ('erp-' . $row['id'])), 0, 40),
                    'name'        => mb_substr($name, 0, 160),
                    'city'        => $row['city'] === null ? null : mb_substr((string) $row['city'], 0, 120),
                    'created_by'  => $auth->userId ?: null,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        $result = [
            'source'  => $schema . '.' . $table,
            'columns' => $columns,
            'read'    => count($rows),
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
        ];

        // L'ERP rattache ses boutiques à une enseigne. Si elles n'en désignent
        // pas toutes la même, les rattacher en bloc à une marque unique est
        // faux — et invisible. On le dit plutôt que de le laisser passer.
        if (isset($columns['brand'])) {
            $distinct = array_unique(array_filter(array_column($rows, 'brand'), static fn ($v): bool => $v !== null));

            if (count($distinct) > 1) {
                $result['warning'] = sprintf(
                    'Les boutiques désignent %d enseignes différentes (%s) : toutes ont été '
                    . 'rattachées à la marque déclarée. Renseignez MAR_ERP_BRANDS_TABLE pour les séparer.',
                    count($distinct),
                    implode(', ', $distinct)
                );
            }

            // Les boutiques disent sous quel identifiant l'ERP connaît cette
            // enseigne. C'est ce numéro que l'ERP mettra dans l'adresse
            // d'ouverture du module (`?brand=1`) : sans lui, le module devrait
            // parier que son propre auto-incrément lui ressemble.
            //
            // Une seule valeur, sinon rien : deux enseignes mêlées ne
            // désignent plus rien, et un mauvais rattachement ouvrirait le
            // périmètre du voisin.
            if (count($distinct) === 1) {
                $erpBrandId = (int) reset($distinct);

                if ($erpBrandId > 0) {
                    $link = $connection->prepare(
                        'UPDATE mar_brand SET erp_brand_id = :erp WHERE id = :id'
                    );
                    $link->execute(['erp' => $erpBrandId, 'id' => $brandId]);
                    $result['erp_brand_id'] = $erpBrandId;
                }
            }
        }

        return $result;
    }

    /**
     * Clients professionnels de l'ERP → vivier B2B.
     *
     * @return array<string, mixed>
     */
    public function syncProspects(AuthContext $auth, int $brandId): array
    {
        [$schema, $table] = $this->source('MAR_ERP_CUSTOMERS_TABLE', 'client');
        $columns = $this->resolve($schema, $table, self::CUSTOMER_COLUMNS, ['id', 'company_name', 'b2b_flag']);

        $where = [$this->b2bPredicate($schema, $table, $columns['b2b_flag'])];

        if (isset($columns['active'])) {
            $where[] = sprintf('`%s` = 1', $columns['active']);
        }

        if (isset($columns['blocked'])) {
            $where[] = sprintf('(`%1$s` IS NULL OR `%1$s` = 0)', $columns['blocked']);
        }

        $rows = $this->readSource($schema, $table, $columns, implode(' AND ', $where));

        // Les boutiques de l'ERP ont été reprises avec leur identifiant
        // d'origine : on s'en sert pour rattacher chaque compte à sa boutique
        // référente, plutôt que de laisser la répartition tourner à l'aveugle.
        $connection = Database::connection();
        $shopByErpId = $connection->query(
            'SELECT erp_shop_id, id FROM mar_shop WHERE erp_shop_id IS NOT NULL'
        )->fetchAll(PDO::FETCH_KEY_PAIR);

        $connection->beginTransaction();

        try {
            $upsert = $connection->prepare(
                'INSERT INTO mar_b2b_prospect
                    (brand_id, external_ref, company_name, contact_name, contact_email,
                     contact_phone, city, postal_code, shop_id, source, created_by)
                 VALUES
                    (:brand_id, :external_ref, :company_name, :contact_name, :contact_email,
                     :contact_phone, :city, :postal_code, :shop_id, :source, :created_by)
                 ON DUPLICATE KEY UPDATE
                    company_name  = VALUES(company_name),
                    contact_name  = VALUES(contact_name),
                    contact_email = VALUES(contact_email),
                    contact_phone = VALUES(contact_phone),
                    city          = VALUES(city),
                    postal_code   = VALUES(postal_code),
                    shop_id       = VALUES(shop_id),
                    is_active     = 1'
            );

            $created   = 0;
            $updated   = 0;
            $skipped   = 0;
            $truncated = 0;

            // Bornes des colonnes du vivier. Un champ annexe plus long que
            // prévu ne doit pas interrompre la reprise de tout un réseau —
            // mais il ne doit pas non plus être rogné en silence, d'où le
            // compteur remonté dans le compte rendu.
            $clamp = static function (mixed $value, int $length) use (&$truncated): ?string {
                if ($value === null || $value === '') {
                    return null;
                }

                $text = (string) $value;
                if (mb_strlen($text) <= $length) {
                    return $text;
                }

                $truncated++;

                return mb_substr($text, 0, $length);
            };

            foreach ($rows as $row) {
                $name = trim((string) ($row['company_name'] ?? ''));
                if ($name === '') {
                    $skipped++;
                    continue;
                }

                $erpShopId = isset($row['shop_id']) ? (int) $row['shop_id'] : 0;

                $upsert->execute([
                    'brand_id'      => $brandId,
                    // Préfixée : le vivier accepte aussi des imports de
                    // fichiers, et deux origines peuvent numéroter pareil.
                    'external_ref'  => 'erp-' . $row['id'],
                    'company_name'  => $clamp($name, 200),
                    'contact_name'  => $clamp($row['contact_name'] ?? null, 160),
                    'contact_email' => $clamp($row['email'] ?? null, 190),
                    'contact_phone' => $clamp($row['phone'] ?? null, 80),
                    'city'          => $clamp($row['city'] ?? null, 120),
                    'postal_code'   => $clamp($row['postal_code'] ?? null, 40),
                    'shop_id'       => $shopByErpId[$erpShopId] ?? null,
                    'source'        => 'ERP',
                    'created_by'    => $auth->userId ?: null,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        return [
            'source'    => $schema . '.' . $table,
            'columns'   => $columns,
            'read'      => count($rows),
            'created'   => $created,
            'updated'   => $updated,
            'skipped'   => $skipped,
            'truncated' => $truncated,
        ];
    }

    /**
     * Types de compte professionnel de l'ERP → secteurs du vivier.
     *
     * Les secteurs étaient jusqu'ici six libellés semés à l'installation, avec
     * des volumes inventés. L'ERP tient la vraie liste : c'est elle qui est
     * reprise, sur `erp_type_id` pour que l'opération soit rejouable.
     *
     * Les secteurs semés sont désactivés dès que l'ERP en fournit — mais
     * seulement à ce moment-là. Les retirer d'abord laisserait l'assistant sans
     * aucun secteur si la reprise échouait ensuite, et une campagne B2B sans
     * secteur ne cible personne.
     *
     * @return array<string, mixed>
     */
    public function syncSectors(int $brandId): array
    {
        [$schema, $table] = $this->source('MAR_ERP_SECTORS_TABLE', 'b2b_client_type');
        $columns = $this->resolve($schema, $table, self::SECTOR_COLUMNS, ['id', 'name']);

        $rows = $this->readSource($schema, $table, $columns);

        // Tri sur le libellé : l'ordre d'affichage de l'assistant est celui de
        // `sort_order`, et l'ordre des identifiants de l'ERP ne veut rien dire
        // pour qui coche des secteurs. La comparaison se fait sur une forme
        // sans accent : sur les octets bruts, « Écoles » et « Événementiel »
        // se retrouvent après « Zurich », loin de leur lettre.
        usort($rows, static fn (array $a, array $b): int => strcmp(
            self::sortKey((string) ($a['name'] ?? '')),
            self::sortKey((string) ($b['name'] ?? ''))
        ));

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $upsert = $connection->prepare(
                'INSERT INTO mar_b2b_sector (code, erp_type_id, label, sort_order)
                 VALUES (:code, :erp_type_id, :label, :sort_order)
                 ON DUPLICATE KEY UPDATE
                    label      = VALUES(label),
                    sort_order = VALUES(sort_order),
                    is_active  = 1'
            );

            $created = 0;
            $updated = 0;
            $skipped = 0;
            $rank    = 0;

            foreach ($rows as $row) {
                $label = trim((string) ($row['name'] ?? ''));
                if ($label === '') {
                    $skipped++;
                    continue;
                }

                $upsert->execute([
                    // Le code dérive de l'identifiant ERP plutôt que du
                    // libellé : deux types peuvent porter le même nom sur deux
                    // enseignes, et un code dérivé du nom les confondrait en un
                    // seul secteur — silencieusement, la clé étant unique.
                    'code'        => 'erp-' . $row['id'],
                    'erp_type_id' => (int) $row['id'],
                    'label'       => mb_substr($label, 0, 120),
                    'sort_order'  => ++$rank,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
            }

            // Les secteurs de l'installation initiale sortent de la liste dès
            // que l'ERP en fournit. Désactivés et non supprimés : les campagnes
            // déjà cadrées sur eux gardent leur périmètre lisible.
            $retired = 0;
            if ($created + $updated > 0) {
                $retire = $connection->prepare(
                    'UPDATE mar_b2b_sector SET is_active = 0
                      WHERE erp_type_id IS NULL AND is_active = 1'
                );
                $retire->execute();
                $retired = $retire->rowCount();
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        $result = [
            'source'  => $schema . '.' . $table,
            'columns' => $columns,
            'read'    => count($rows),
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'retired' => $retired,
        ];

        if (isset($columns['brand'])) {
            $distinct = array_unique(array_filter(
                array_column($rows, 'brand'),
                static fn ($v): bool => $v !== null
            ));

            if (count($distinct) > 1) {
                $result['warning'] = sprintf(
                    'Les types de compte relèvent de %d enseignes différentes : tous ont été '
                    . 'repris comme secteurs de la marque déclarée.',
                    count($distinct)
                );
            }
        }

        return $result;
    }

    /**
     * Table de liaison client ↔ type de compte → `mar_b2b_prospect_sector`.
     *
     * Les deux colonnes ne sont pas devinées à partir de noms plausibles. Elles
     * sont d'abord cherchées dans les contraintes, qui nomment leur cible sans
     * ambiguïté ; à défaut, dans la convention de nommage de cet ERP, dérivée du
     * nom de la table visée. Faute des deux, on s'arrête en nommant les colonnes
     * réellement présentes.
     *
     * Ce refus est la raison d'être de la méthode. Une table nommée
     * « …_interest_connection » peut désigner les centres d'intérêt et non les
     * types de compte : les deux référentiels sont numérotés à partir de 1, si
     * bien qu'une correspondance prise au hasard rattache tous les comptes à des
     * secteurs faux, sans qu'aucune erreur ne se produise nulle part.
     *
     * @return array<string, mixed>
     */
    public function syncProspectSectors(int $brandId): array
    {
        [$schema, $junction]  = $this->source('MAR_ERP_SECTOR_LINK_TABLE', 'b2b_client_interest_connection');
        [, $customersTable]   = $this->source('MAR_ERP_CUSTOMERS_TABLE', 'client');
        [, $sectorsTable]     = $this->source('MAR_ERP_SECTORS_TABLE', 'b2b_client_type');

        $present = $this->columnsOf($schema, $junction);

        if ($present === []) {
            throw new RuntimeException(sprintf(
                'Table de liaison « %s.%s » introuvable. Renseignez MAR_ERP_SECTOR_LINK_TABLE.',
                $schema,
                $junction
            ));
        }

        $clientColumn = $this->columnPointingTo(
            $schema,
            $junction,
            $customersTable,
            $present,
            'MAR_ERP_SECTOR_LINK_CLIENT_COLUMN',
            self::LINK_CLIENT_COLUMNS
        );
        $sectorColumn = $this->columnPointingTo(
            $schema,
            $junction,
            $sectorsTable,
            $present,
            'MAR_ERP_SECTOR_LINK_SECTOR_COLUMN',
            self::LINK_SECTOR_COLUMNS
        );

        if ($clientColumn === null || $sectorColumn === null) {
            // Message tenu court et sur une seule ligne : il ressort tel quel
            // dans une annotation de déploiement, tronquée à neuf cents
            // caractères. La mesure passe avant le rappel de la règle — c'est
            // elle qui dit quoi configurer.
            throw new RuntimeException(sprintf(
                'Dans « %s.%s », la colonne du %s n\'est désignée ni par une contrainte ni par '
                . 'la convention « id_<table> ». Colonnes : %s. Correspondance des valeurs : %s. '
                . 'Aucun rattachement effectué — voir MAR_ERP_SECTOR_LINK_TABLE / MAR_ERP_SECTORS_TABLE.',
                $schema,
                $junction,
                $clientColumn === null ? 'client' : 'type de compte',
                implode(', ', $present),
                $this->coverage($schema, $junction, $present, [$customersTable, $sectorsTable])
            ));
        }

        $this->inventory[$schema . '.' . $junction] = [
            'non reconnues' => [],
            'disponibles'   => $present,
        ];

        $links = Database::connection()->query(sprintf(
            'SELECT `%s` AS `client`, `%s` AS `sector` FROM `%s`.`%s`
              WHERE `%s` IS NOT NULL AND `%s` IS NOT NULL',
            $clientColumn,
            $sectorColumn,
            $schema,
            $junction,
            $clientColumn,
            $sectorColumn
        ))->fetchAll();

        $columns = ['client' => $clientColumn, 'sector' => $sectorColumn];

        // Ce que les colonnes retenues valent réellement, mesuré et rendu à
        // chaque reprise. Deux d'entre elles ont été reconnues par leur nom, ce
        // qui ne prouve rien : `id_interest` porte ici le type de compte, mais
        // le même nom ailleurs désignerait un centre d'intérêt. La part des
        // valeurs qui retombe sur la table visée le dit sans discussion.
        $match = $this->matchRate($schema, $junction, [
            $clientColumn => $customersTable,
            $sectorColumn => $sectorsTable,
        ]);

        // Une table vide ne vaut pas « plus aucun compte n'a de secteur » : ce
        // serait aussi la conséquence d'un droit de lecture manquant. On ne
        // détruit pas les rattachements existants sur cette base.
        if ($links === []) {
            return [
                'source'         => $schema . '.' . $junction,
                'columns'        => $columns,
                'match'          => $match,
                'read'           => 0,
                'linked'         => 0,
                'unknown_client' => 0,
                'unknown_sector' => 0,
                'removed'        => 0,
                'warning'        => 'Table de liaison vide : les rattachements en base sont conservés.',
            ];
        }

        $connection = Database::connection();

        $prospects = $connection->prepare(
            'SELECT external_ref, id FROM mar_b2b_prospect
              WHERE brand_id = :brand_id AND source = \'ERP\' AND external_ref IS NOT NULL'
        );
        $prospects->execute(['brand_id' => $brandId]);
        $prospectByRef = $prospects->fetchAll(PDO::FETCH_KEY_PAIR);

        $sectorByErp = $connection->query(
            'SELECT erp_type_id, id FROM mar_b2b_sector WHERE erp_type_id IS NOT NULL'
        )->fetchAll(PDO::FETCH_KEY_PAIR);

        $connection->beginTransaction();

        try {
            // Les rattachements repris de l'ERP sont refaits en entier : un
            // client qui change de type verrait sinon son ancien secteur
            // subsister à côté du nouveau. Seuls ceux-là sont effacés — les
            // secteurs saisis par import de fichier ne viennent pas de l'ERP et
            // n'ont pas à disparaître parce que l'ERP ne les connaît pas.
            $purge = $connection->prepare(
                'DELETE ps FROM mar_b2b_prospect_sector ps
                   JOIN mar_b2b_prospect p ON p.id = ps.prospect_id
                   JOIN mar_b2b_sector   s ON s.id = ps.sector_id
                  WHERE p.brand_id = :brand_id
                    AND p.source   = \'ERP\'
                    AND s.erp_type_id IS NOT NULL'
            );
            $purge->execute(['brand_id' => $brandId]);
            $removed = $purge->rowCount();

            $insert = $connection->prepare(
                'INSERT IGNORE INTO mar_b2b_prospect_sector (prospect_id, sector_id)
                 VALUES (:prospect_id, :sector_id)'
            );

            $linked        = 0;
            $unknownClient = 0;
            $unknownSector = 0;

            foreach ($links as $link) {
                $prospectId = $prospectByRef['erp-' . $link['client']] ?? null;
                $sectorId   = $sectorByErp[(int) $link['sector']] ?? null;

                if ($prospectId === null) {
                    // Cas normal : le client existe mais n'est pas
                    // professionnel, donc pas dans le vivier.
                    $unknownClient++;
                    continue;
                }

                if ($sectorId === null) {
                    $unknownSector++;
                    continue;
                }

                $insert->execute(['prospect_id' => (int) $prospectId, 'sector_id' => (int) $sectorId]);
                $linked++;
            }

            $connection->commit();
        } catch (Throwable $failure) {
            $connection->rollBack();

            throw $failure;
        }

        // Un compte du vivier sans aucun secteur ne sortira jamais d'une
        // génération : elle ne retient que les secteurs de la campagne. Il
        // existe, se compte dans le vivier, et reste indémarchable — le seul
        // endroit où cela peut se voir est ici.
        $orphans = $connection->prepare(
            'SELECT COUNT(*) FROM mar_b2b_prospect p
              WHERE p.brand_id = :brand_id
                AND p.is_active = 1
                AND NOT EXISTS (
                      SELECT 1 FROM mar_b2b_prospect_sector ps WHERE ps.prospect_id = p.id
                )'
        );
        $orphans->execute(['brand_id' => $brandId]);

        $result = [
            'source'         => $schema . '.' . $junction,
            'columns'        => $columns,
            'match'          => $match,
            'read'           => count($links),
            'linked'         => $linked,
            'unknown_client' => $unknownClient,
            'unknown_sector' => $unknownSector,
            'removed'        => $removed,
            'without_sector' => (int) $orphans->fetchColumn(),
        ];

        // Un identifiant de type que le référentiel des secteurs ne connaît pas
        // sur *toutes* les lignes ne se rattrape pas : cela veut dire que la
        // table de liaison ne désigne pas ce référentiel-là. Le dire vaut mieux
        // que rendre « 0 rattaché » au milieu d'un compte rendu par ailleurs
        // normal.
        if ($linked === 0 && $unknownSector > 0) {
            $result['warning'] = sprintf(
                'Aucun rattachement : les %d valeurs de « %s » ne correspondent à aucun type '
                . 'repris de « %s ». La table de liaison désigne vraisemblablement un autre '
                . 'référentiel — renseignez MAR_ERP_SECTORS_TABLE. Correspondance mesurée : %s.',
                $unknownSector,
                $sectorColumn,
                $sectorsTable,
                $match
            );
        }

        return $result;
    }

    /**
     * Où atterrissent réellement les valeurs d'une table de liaison.
     *
     * Quand ni les contraintes ni les noms ne disent vers quoi pointe une
     * colonne, les données le disent : `id_interest` qui retrouve ses six
     * valeurs dans `b2b_client_type` et aucune dans `b2b_client_interest` ne
     * laisse plus de doute sur ce qu'il désigne, quel que soit son nom.
     *
     * C'est une mesure, pas une déduction : elle est rendue dans le message
     * d'échec pour que la personne qui renseigne la configuration décide, au
     * lieu de refaire la même enquête à chaque installation. Lecture seule, et
     * bornée aux tables candidates — on ne balaie pas le schéma entier.
     *
     * @param  list<string> $columns
     * @param  list<string> $tables
     */
    private function coverage(string $schema, string $junction, array $columns, array $tables): string
    {
        $safe = static fn (string $name): bool => preg_match('/^[A-Za-z0-9_]+$/', $name) === 1;

        // Les tables que les noms de colonnes suggèrent, en plus des deux
        // configurées : `id_interest` propose `interest`, `id_b2b_client`
        // propose `b2b_client`. Une colonne qui nomme sa cible mérite qu'on
        // vérifie si cette cible existe.
        foreach ($columns as $column) {
            $stripped = preg_replace('/^id_|_id$/', '', $column);
            if ($stripped !== null && $stripped !== '' && $stripped !== $column) {
                $tables[] = $stripped;
            }
        }

        // Et le référentiel que le nom de la table de liaison désigne :
        // `b2b_client_interest_connection` renvoie à `b2b_client_interest`.
        // C'est le candidat le plus probable quand la liaison ne pointe pas où
        // la configuration le croit — donc celui qu'il faut mesurer.
        $named = preg_replace('/_(connection|link|rel|assoc|mapping)$/', '', $junction);
        if ($named !== null && $named !== $junction) {
            $tables[] = $named;
        }

        $report = [];

        foreach (array_unique($tables) as $table) {
            if (!$safe($table) || !in_array('id', array_map('strtolower', $this->columnsOf($schema, $table)), true)) {
                continue;
            }

            foreach ($columns as $column) {
                if (!$safe($column) || strtolower($column) === 'id') {
                    continue;
                }

                $hit = $this->valuesFoundIn($schema, $junction, $column, $table);
                if ($hit['total'] > 0) {
                    $report[] = sprintf('%s → %s %d/%d', $column, $table, $hit['found'], $hit['total']);
                }
            }
        }

        return $report === [] ? 'aucune table candidate lisible' : implode(' ; ', $report);
    }

    /**
     * Correspondance des colonnes finalement retenues.
     *
     * Rendue à chaque reprise, et pas seulement en cas d'échec : deux des
     * quatre sources de résolution ne sont que des noms, et un nom peut être
     * juste sur une installation et faux sur la suivante. Le rapport « 4/4 » ou
     * « 1/2 » est ce qui permet de s'en apercevoir avant que le vivier ne soit
     * démarché sur des secteurs faux.
     *
     * @param  array<string, string> $pairs colonne => table visée
     */
    private function matchRate(string $schema, string $junction, array $pairs): string
    {
        $report = [];

        foreach ($pairs as $column => $table) {
            $hit      = $this->valuesFoundIn($schema, $junction, $column, $table);
            $report[] = sprintf('%s → %s %d/%d', $column, $table, $hit['found'], $hit['total']);
        }

        return implode(' ; ', $report);
    }

    /**
     * Part des valeurs distinctes d'une colonne qui existent dans une table.
     *
     * @return array{found:int, total:int}
     */
    private function valuesFoundIn(string $schema, string $junction, string $column, string $table): array
    {
        foreach ([$schema, $junction, $column, $table] as $fragment) {
            if (preg_match('/^[A-Za-z0-9_]+$/', $fragment) !== 1) {
                return ['found' => 0, 'total' => 0];
            }
        }

        $row = Database::connection()->query(sprintf(
            'SELECT COUNT(*) AS total, COUNT(t.id) AS trouves
               FROM (SELECT DISTINCT `%s` AS v FROM `%s`.`%s` WHERE `%s` IS NOT NULL) j
               LEFT JOIN `%s`.`%s` t ON t.id = j.v',
            $column,
            $schema,
            $junction,
            $column,
            $schema,
            $table
        ))->fetch();

        return ['found' => (int) $row['trouves'], 'total' => (int) $row['total']];
    }

    /**
     * Colonne d'une table qui désigne une autre table.
     *
     * Quatre sources, de la plus sûre à la moins sûre : la contrainte, qui
     * l'affirme ; la configuration, où quelqu'un l'a écrite en connaissance de
     * cause ; la convention `id_<table>` de cet ERP ; enfin une liste de noms
     * relevés sur les installations connues.
     *
     * Cette dernière n'est pas une preuve, et c'est pourquoi le rattachement
     * mesure ensuite la part des valeurs qui retombe réellement sur la table
     * visée, et la rapporte. Une colonne retenue par son nom mais pointant
     * ailleurs se voit alors dans le compte rendu, au lieu de produire des
     * secteurs faux sans que rien ne bouge.
     *
     * @param  list<string> $present
     * @param  list<string> $fallback
     */
    private function columnPointingTo(
        string $schema,
        string $table,
        string $target,
        array $present,
        ?string $variable = null,
        array $fallback = []
    ): ?string {
        $statement = Database::connection()->prepare(
            'SELECT column_name FROM information_schema.key_column_usage
              WHERE table_schema = :schema
                AND table_name = :table
                AND referenced_table_name = :target
              ORDER BY column_name
              LIMIT 1'
        );
        $statement->execute(['schema' => $schema, 'table' => $table, 'target' => $target]);

        $declared = $statement->fetchColumn();
        if ($declared !== false) {
            return (string) $declared;
        }

        $lower = array_map('strtolower', $present);

        $find = static function (string $candidate) use ($lower, $present): ?string {
            $index = array_search(strtolower($candidate), $lower, true);

            return $index === false ? null : $present[$index];
        };

        // Colonne imposée par la configuration. Elle prime sur les conventions,
        // mais doit exister : une valeur obsolète après une migration de l'ERP
        // ne doit pas faire retomber silencieusement sur une autre colonne.
        if ($variable !== null) {
            $configured = trim((string) (Env::get($variable, '') ?: ''));
            if ($configured !== '') {
                $match = $find($configured);
                if ($match === null) {
                    throw new RuntimeException(sprintf(
                        '%s désigne « %s », absente de « %s.%s ». Colonnes présentes : %s.',
                        $variable,
                        $configured,
                        $schema,
                        $table,
                        implode(', ', $present)
                    ));
                }

                return $match;
            }
        }

        foreach ([$target . '_id', 'id_' . $target, ...$fallback] as $candidate) {
            $match = $find($candidate);
            if ($match !== null) {
                return $match;
            }
        }

        return null;
    }

    /**
     * Colonnes d'une table, sans exiger qu'elle existe.
     *
     * @return list<string>
     */
    private function columnsOf(string $schema, string $table): array
    {
        $statement = Database::connection()->prepare(
            'SELECT column_name FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table
              ORDER BY ordinal_position'
        );
        $statement->execute(['schema' => $schema, 'table' => $table]);

        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    /**
     * Table source, sous la forme `table` ou `schéma.table`.
     *
     * Sans schéma, c'est la base du module — l'ERP et le marketing partagent
     * souvent la même, et y écrire son nom en dur le figerait pour toutes les
     * installations. Le nom est validé par une expression stricte : ces
     * fragments finissent dans du SQL, où un nom de table ne peut pas être lié
     * comme un paramètre.
     *
     * @return array{0:string, 1:string}
     */
    private function source(string $variable, string $default): array
    {
        $value = trim((string) (Env::get($variable, $default) ?: $default));

        if (preg_match('/^(?:([A-Za-z0-9_]+)\.)?([A-Za-z0-9_]+)$/', $value, $matches) !== 1) {
            throw new RuntimeException(sprintf(
                '%s doit être « table » ou « schéma.table » ; reçu « %s ».',
                $variable,
                $value
            ));
        }

        return [$matches[1] !== '' ? $matches[1] : $this->currentSchema(), $matches[2]];
    }

    /**
     * Condition « ce client est un professionnel ».
     *
     * Elle dépend de ce que la colonne contient réellement. Un `is_b2b` vaut 0
     * ou 1 ; un `b2b_client_type` porte un type de compte, et c'est sa présence
     * qui fait foi. Écrire « = 1 » dans les deux cas ne retiendrait que le
     * premier type de la liste ; écrire « <> 0 » sur une colonne de texte
     * ferait comparer une chaîne à un nombre, que MySQL évalue à zéro — tous
     * les clients seraient alors écartés, en silence.
     */
    private function b2bPredicate(string $schema, string $table, string $column): string
    {
        $statement = Database::connection()->prepare(
            'SELECT data_type FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table AND column_name = :column'
        );
        $statement->execute(['schema' => $schema, 'table' => $table, 'column' => $column]);

        $type      = strtolower((string) $statement->fetchColumn());
        $isNumeric = in_array($type, [
            'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
            'decimal', 'numeric', 'float', 'double', 'bit',
        ], true);

        return $isNumeric
            ? sprintf('`%1$s` IS NOT NULL AND `%1$s` <> 0', $column)
            : sprintf('`%1$s` IS NOT NULL AND `%1$s` <> \'\' AND `%1$s` <> \'0\'', $column);
    }

    /** Base sur laquelle la connexion est ouverte. */
    private function currentSchema(): string
    {
        return (string) Database::connection()->query('SELECT DATABASE()')->fetchColumn();
    }

    /**
     * Correspondance notion → colonne réelle, découverte dans le schéma.
     *
     * @param  array<string, list<string>> $candidates
     * @param  list<string>                $required
     * @return array<string, string>
     */
    private function resolve(string $schema, string $table, array $candidates, array $required): array
    {
        $this->inventory[$schema . '.' . $table] = [];

        $statement = Database::connection()->prepare(
            'SELECT column_name FROM information_schema.columns
              WHERE table_schema = :schema AND table_name = :table'
        );
        $statement->execute(['schema' => $schema, 'table' => $table]);

        $present = array_map('strtolower', $statement->fetchAll(PDO::FETCH_COLUMN));

        if ($present === []) {
            throw new RuntimeException(sprintf(
                'Table « %s.%s » introuvable, ou aucun droit de lecture dessus.',
                $schema,
                $table
            ));
        }

        $resolved = [];
        foreach ($candidates as $notion => $names) {
            foreach ($names as $name) {
                if (in_array(strtolower($name), $present, true)) {
                    $resolved[$notion] = $name;
                    break;
                }
            }
        }

        // Ce qui n'a pas été reconnu, et ce que la table contient réellement.
        // Sans cet inventaire, une notion facultative absente — la boutique de
        // rattachement d'un client, par exemple — se traduit par un silence :
        // la reprise réussit et le champ reste vide, sans qu'on sache si la
        // colonne manque ou si elle porte un nom auquel on n'a pas pensé.
        $this->inventory[$schema . '.' . $table] = [
            'non reconnues' => array_values(array_diff(array_keys($candidates), array_keys($resolved))),
            'disponibles'   => $present,
        ];

        $missing = array_values(array_diff($required, array_keys($resolved)));
        if ($missing !== []) {
            throw new RuntimeException(sprintf(
                'Colonnes introuvables dans « %s.%s » : %s. Colonnes présentes : %s.',
                $schema,
                $table,
                implode(', ', $missing),
                implode(', ', $present)
            ));
        }

        return $resolved;
    }

    /**
     * Lit la source avec les colonnes résolues, renommées vers les notions.
     *
     * @param  array<string, string> $columns
     * @return list<array<string, mixed>>
     */
    private function readSource(string $schema, string $table, array $columns, ?string $where = null): array
    {
        $select = [];
        foreach ($columns as $notion => $column) {
            $select[] = sprintf('`%s` AS `%s`', $column, $notion);
        }

        $sql = sprintf(
            'SELECT %s FROM `%s`.`%s`%s',
            implode(', ', $select),
            $schema,
            $table,
            $where !== null ? ' WHERE ' . $where : ''
        );

        return Database::connection()->query($sql)->fetchAll();
    }
}
