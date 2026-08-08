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
 * Rien n'est supposé du schéma : les colonnes sont découvertes dans
 * `information_schema`, et la synchronisation rapporte celles qu'elle a
 * utilisées. Une correspondance devinée qui tombe juste par hasard est plus
 * dangereuse qu'une erreur franche — elle importe des données fausses sans
 * prévenir.
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
        'id'        => ['id', 'shop_id'],
        'name'      => ['name', 'label', 'shop_name', 'nom'],
        'code'      => ['code', 'slug', 'reference'],
        'city'      => ['city', 'ville', 'town'],
        'is_active' => ['is_active', 'active', 'enabled', 'actif'],
    ];

    /** @var array<string, list<string>> */
    private const CUSTOMER_COLUMNS = [
        'id'           => ['id', 'customer_id'],
        'company_name' => ['company_name', 'company', 'raison_sociale', 'societe', 'name', 'nom'],
        'contact_name' => ['contact_name', 'contact', 'firstname', 'full_name'],
        'email'        => ['email', 'mail', 'contact_email'],
        'phone'        => ['phone', 'tel', 'telephone', 'contact_phone'],
        'city'         => ['city', 'ville', 'town'],
        'postal_code'  => ['postal_code', 'zip', 'cp', 'zipcode'],
        'shop_id'      => ['shop_id', 'boutique_id', 'store_id'],
        'is_b2b'       => ['is_b2b', 'b2b', 'is_professional', 'professionnel'],
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
        [$schema, $table] = $this->source('MAR_ERP_SHOPS_TABLE', 'franchise.shops');
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
        [$schema, $table] = $this->source('MAR_ERP_CUSTOMERS_TABLE', 'franchise.customers');
        $columns = $this->resolve($schema, $table, self::CUSTOMER_COLUMNS, ['id', 'company_name', 'is_b2b']);

        $rows = $this->readSource($schema, $table, $columns, sprintf('%s = 1', $columns['is_b2b']));

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
     * Table source, sous la forme `schéma.table`.
     *
     * Configurable parce que le nom varie d'une installation à l'autre, et
     * validée par une expression stricte : ces deux fragments finissent dans du
     * SQL, où aucun paramètre lié n'est possible pour un nom de table.
     *
     * @return array{0:string, 1:string}
     */
    private function source(string $variable, string $default): array
    {
        $value = (string) (Env::get($variable, $default) ?: $default);

        if (preg_match('/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/', $value, $matches) !== 1) {
            throw new RuntimeException(sprintf(
                '%s doit être de la forme « schéma.table » ; reçu « %s ».',
                $variable,
                $value
            ));
        }

        return [$matches[1], $matches[2]];
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
