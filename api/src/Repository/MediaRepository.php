<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use PDO;

/**
 * La médiathèque commune : seul endroit où son SQL s'écrit.
 *
 * Les filtres arrivent déjà validés (liste blanche du contrôleur) ; ce dépôt ne
 * fait que les traduire en paramètres liés — aucune valeur reçue n'entre dans
 * le texte d'une requête.
 */
final class MediaRepository
{
    /** Tri accepté → colonne. */
    public const SORTS = [
        'createdAt' => 'm.created_at',
        'updatedAt' => 'm.updated_at',
        'name'      => 'm.name',
        'bytes'     => 'm.bytes',
    ];

    private const SELECT = <<<'SQL'
        SELECT m.id, m.kind, m.file_path, m.thumb_path, m.web_path, m.mime, m.bytes, m.width, m.height, m.sha256,
               m.name, m.cutout, m.source, m.created_at, m.updated_at, m.archived_at,
               m.category_code, c.label AS category_label,
               m.subcategory_code, sc.label AS subcategory_label,
               m.season_code, se.label AS season_label,
               m.offer_item_id, oi.name AS offer_item_name,
               m.shop_id, sh.name AS shop_name
          FROM mar_media m
          LEFT JOIN mar_media_category c  ON c.code  = m.category_code
          LEFT JOIN mar_media_category sc ON sc.code = m.subcategory_code
          LEFT JOIN mar_media_season   se ON se.code = m.season_code
          LEFT JOIN mar_offer_item     oi ON oi.id   = m.offer_item_id
          LEFT JOIN mar_shop           sh ON sh.id   = m.shop_id
        SQL;

    /**
     * Une page de la médiathèque, et le nombre total de fichiers qui répondent.
     *
     * @param array{kind?:string, category?:string, categoryIsNull?:bool, subcategory?:string, season?:string,
     *              offerItem?:int, shop?:int, source?:string, archived?:bool, name?:string} $filters
     * @return array{rows:list<array<string,mixed>>, total:int}
     */
    public function page(array $filters, string $sort, bool $descending, int $page, int $perPage): array
    {
        [$where, $params] = self::where($filters);
        $pdo = Database::connection();

        $count = $pdo->prepare('SELECT COUNT(*) FROM mar_media m WHERE ' . $where);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $column = self::SORTS[$sort] ?? 'm.created_at';
        $order  = $column . ($descending ? ' DESC' : ' ASC') . ', m.id' . ($descending ? ' DESC' : ' ASC');

        $statement = $pdo->prepare(self::SELECT . ' WHERE ' . $where . ' ORDER BY ' . $order . ' LIMIT :limit OFFSET :offset');
        foreach ($params as $key => $value) {
            $statement->bindValue($key, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $statement->bindValue('limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue('offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $statement->execute();

        return ['rows' => $statement->fetchAll(), 'total' => $total];
    }

    /** @return array<string,mixed>|null */
    public function find(int $id): ?array
    {
        $statement = Database::connection()->prepare(self::SELECT . ' WHERE m.id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /** @return array<string,mixed>|null */
    public function findBySha(string $sha256): ?array
    {
        $statement = Database::connection()->prepare(self::SELECT . ' WHERE m.sha256 = :sha');
        $statement->execute(['sha' => $sha256]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /** @param array<string,mixed> $row Colonnes de `mar_media`, déjà validées. */
    public function insert(array $row): int
    {
        $columns = array_keys($row);
        $statement = Database::connection()->prepare(sprintf(
            'INSERT INTO mar_media (%s) VALUES (%s)',
            implode(', ', $columns),
            implode(', ', array_map(static fn (string $c): string => ':' . $c, $columns))
        ));
        $statement->execute($row);

        return (int) Database::connection()->lastInsertId();
    }

    /** @param array<string,mixed> $fields Colonnes modifiables, déjà validées. */
    public function update(int $id, array $fields): void
    {
        if ($fields === []) {
            return;
        }
        $sets = implode(', ', array_map(static fn (string $c): string => $c . ' = :' . $c, array_keys($fields)));
        $statement = Database::connection()->prepare('UPDATE mar_media SET ' . $sets . ' WHERE id = :id');
        $statement->execute($fields + ['id' => $id]);
    }

    /** Retire le fichier de la médiathèque (ou l'y remet) ; le fichier, lui, reste servi. */
    public function setArchived(int $id, bool $archived): void
    {
        $statement = Database::connection()->prepare(
            $archived
                ? 'UPDATE mar_media SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = :id'
                : 'UPDATE mar_media SET archived_at = NULL WHERE id = :id'
        );
        $statement->execute(['id' => $id]);
    }

    /**
     * Catégories et sous-catégories, dans l'ordre d'affichage.
     *
     * @return list<array{code:string, label:string, parent_code:?string, sort_order:int, files:int}>
     */
    public function categories(): array
    {
        return Database::connection()->query(
            'SELECT c.code, c.label, c.parent_code, c.sort_order,
                    (SELECT COUNT(*) FROM mar_media m
                      WHERE m.archived_at IS NULL AND (m.category_code = c.code OR m.subcategory_code = c.code)) AS files
               FROM mar_media_category c
              ORDER BY COALESCE((SELECT p.sort_order FROM mar_media_category p WHERE p.code = c.parent_code), c.sort_order),
                       c.parent_code IS NOT NULL, c.sort_order, c.label'
        )->fetchAll();
    }

    /** @return array{all:int, uncategorized:int, archived:int} */
    public function counts(): array
    {
        $row = Database::connection()->query(
            'SELECT SUM(archived_at IS NULL) AS all_files,
                    SUM(archived_at IS NULL AND category_code IS NULL) AS uncategorized,
                    SUM(archived_at IS NOT NULL) AS archived
               FROM mar_media'
        )->fetch();

        return [
            'all'           => (int) ($row['all_files'] ?? 0),
            'uncategorized' => (int) ($row['uncategorized'] ?? 0),
            'archived'      => (int) ($row['archived'] ?? 0),
        ];
    }

    /** @return list<array{code:string, label:string, sort_order:int}> */
    public function seasons(): array
    {
        return Database::connection()->query(
            'SELECT code, label, sort_order FROM mar_media_season ORDER BY sort_order, label'
        )->fetchAll();
    }

    /** Le parent d'une catégorie : `false` si elle n'existe pas, `null` si c'est une catégorie de tête. */
    public function categoryParent(string $code): string|false|null
    {
        $statement = Database::connection()->prepare('SELECT parent_code FROM mar_media_category WHERE code = :code');
        $statement->execute(['code' => $code]);
        $row = $statement->fetch();

        return is_array($row) ? ($row['parent_code'] !== null ? (string) $row['parent_code'] : null) : false;
    }

    public function seasonExists(string $code): bool
    {
        return $this->exists('SELECT 1 FROM mar_media_season WHERE code = :v', $code);
    }

    public function offerItemExists(int $id): bool
    {
        return $this->exists('SELECT 1 FROM mar_offer_item WHERE id = :v', $id);
    }

    public function shopExists(int $id): bool
    {
        return $this->exists('SELECT 1 FROM mar_shop WHERE id = :v', $id);
    }

    private function exists(string $sql, int|string $value): bool
    {
        $statement = Database::connection()->prepare($sql);
        $statement->execute(['v' => $value]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @param array<string,mixed> $filters
     * @return array{0:string, 1:array<string,int|string>}
     */
    private static function where(array $filters): array
    {
        $where  = [($filters['archived'] ?? false) ? 'm.archived_at IS NOT NULL' : 'm.archived_at IS NULL'];
        $params = [];

        $equal = [
            'kind'        => 'm.kind',
            'category'    => 'm.category_code',
            'subcategory' => 'm.subcategory_code',
            'season'      => 'm.season_code',
            'offerItem'   => 'm.offer_item_id',
            'shop'        => 'm.shop_id',
            'source'      => 'm.source',
        ];
        foreach ($equal as $key => $column) {
            if (array_key_exists($key, $filters)) {
                $where[]      = $column . ' = :f_' . $key;
                $params['f_' . $key] = $filters[$key];
            }
        }
        if (($filters['categoryIsNull'] ?? null) === true) {
            $where[] = 'm.category_code IS NULL';
        } elseif (($filters['categoryIsNull'] ?? null) === false) {
            $where[] = 'm.category_code IS NOT NULL';
        }

        // Chaque mot doit se trouver dans le nom, la catégorie, la sous-catégorie ou le produit.
        $words = preg_split('/\s+/', trim((string) ($filters['name'] ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach (array_slice($words, 0, 6) as $i => $word) {
            // Préparations natives : un paramètre nommé ne sert qu'une fois, d'où trois noms par mot.
            $key = 'q' . $i;
            $where[] = sprintf(
                '(m.name LIKE :%1$sa OR EXISTS (SELECT 1 FROM mar_media_category qc WHERE qc.code IN (m.category_code, m.subcategory_code) AND qc.label LIKE :%1$sb)'
                . ' OR EXISTS (SELECT 1 FROM mar_offer_item qi WHERE qi.id = m.offer_item_id AND qi.name LIKE :%1$sc))',
                $key
            );
            $like = '%' . addcslashes($word, '%_\\') . '%';
            $params[$key . 'a'] = $like;
            $params[$key . 'b'] = $like;
            $params[$key . 'c'] = $like;
        }

        return [implode(' AND ', $where), $params];
    }
}
