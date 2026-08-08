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
     * Colonnes candidates, par notion. La première trouvée l'emporte.
     *
     * Plusieurs noms par notion parce qu'un ERP francophone hésite entre
     * `zip`, `cp` et `postal_code` selon les tables, et qu'imposer un nom
     * unique reviendrait à demander une migration côté ERP pour lire ses
     * données.
     *
     * @var array<string, list<string>>
     */
    private const SHOP_COLUMNS = [
        // `id_franchisee_shop` / `id_shop` : cet ERP préfixe ses clés du nom de
        // la table, convention répandue et incompatible avec un simple `id`.
        'id'        => ['id', 'id_franchisee_shop', 'id_shop', 'shop_id'],
        'name'      => ['name', 'label', 'shop_name', 'nom', 'libelle'],
        'code'      => ['code', 'slug', 'reference'],
        'city'      => ['city', 'ville', 'town'],
        'is_active' => ['is_active', 'active', 'enabled', 'actif'],
    ];

    /** @var array<string, list<string>> */
    private const CUSTOMER_COLUMNS = [
        'id'           => ['id', 'id_client', 'id_customer', 'customer_id'],
        'company_name' => ['company_name', 'company', 'raison_sociale', 'societe', 'name', 'nom'],
        'contact_name' => ['contact_name', 'contact', 'firstname', 'full_name', 'prenom'],
        'email'        => ['email', 'mail', 'contact_email'],
        'phone'        => ['phone', 'tel', 'telephone', 'contact_phone', 'gsm'],
        'city'         => ['city', 'ville', 'town'],
        'postal_code'  => ['postal_code', 'zip', 'cp', 'zipcode', 'code_postal'],
        // Boutique de rattachement du client : `id_mainshop` sur cette
        // installation, d'où sa place en tête.
        'shop_id'      => ['id_mainshop', 'shop_id', 'id_shop', 'boutique_id', 'store_id'],
        // Le marqueur professionnel n'est pas forcément un booléen : sur cette
        // installation c'est `b2b_client_type`, un type de compte, où « être
        // B2B » signifie « en avoir un ». D'où un nom de notion neutre et un
        // test déduit du type réel de la colonne, plus bas.
        'b2b_flag'     => ['b2b_client_type', 'is_b2b', 'b2b', 'is_professional', 'professionnel'],
    ];

    /**
     * Synchronise boutiques et comptes B2B.
     *
     * @return array<string, mixed>
     */
    public function sync(AuthContext $auth, int $brandId): array
    {
        return [
            'shops'     => $this->syncShops($auth, $brandId),
            'prospects' => $this->syncProspects($auth, $brandId),
        ];
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
            $upsert = $connection->prepare(
                'INSERT INTO mar_shop (brand_id, erp_shop_id, code, name, city, created_by)
                 VALUES (:brand_id, :erp_shop_id, :code, :name, :city, :created_by)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name), city = VALUES(city), code = VALUES(code)'
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

                $name = trim((string) ($row['name'] ?? ''));
                if ($name === '') {
                    $skipped++;
                    continue;
                }

                $upsert->execute([
                    'brand_id'    => $brandId,
                    'erp_shop_id' => (int) $row['id'],
                    // `code` est unique par marque : à défaut, l'identifiant
                    // ERP fait un code stable, ce qu'un nom n'est pas.
                    'code'        => (string) ($row['code'] ?? ('erp-' . $row['id'])),
                    'name'        => $name,
                    'city'        => $row['city'] ?? null,
                    'created_by'  => $auth->userId,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
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
        ];
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

        $rows = $this->readSource(
            $schema,
            $table,
            $columns,
            $this->b2bPredicate($schema, $table, $columns['b2b_flag'])
        );

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

            $created = 0;
            $updated = 0;
            $skipped = 0;

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
                    'company_name'  => $name,
                    'contact_name'  => $row['contact_name'] ?? null,
                    'contact_email' => $row['email'] ?? null,
                    'contact_phone' => $row['phone'] ?? null,
                    'city'          => $row['city'] ?? null,
                    'postal_code'   => $row['postal_code'] ?? null,
                    'shop_id'       => $shopByErpId[$erpShopId] ?? null,
                    'source'        => 'ERP',
                    'created_by'    => $auth->userId,
                ]);

                $upsert->rowCount() === 1 ? $created++ : $updated++;
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
        ];
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
