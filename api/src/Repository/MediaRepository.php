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
               m.shop_id, sh.name AS shop_name, m.valid_until
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
     *              offerItem?:int, shop?:int, source?:string, archived?:bool, name?:string, moment?:string,
     *              usage?:string, product?:string, tag?:string, format?:string, valid?:bool} $filters
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

    /** @return array{all:int, uncategorized:int, archived:int, proposals:int} */
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
            'proposals'     => $this->pendingTotal(),
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

    // --- Étiquettes ------------------------------------------------------------

    /**
     * Les étiquettes de plusieurs fichiers d'un coup (une page de la liste).
     *
     * @param list<int> $ids
     * @return array<int, list<array{family:string, value:string, label:?string}>>
     */
    public function tagsFor(array $ids): array
    {
        $out = array_fill_keys($ids, []);
        if ($ids === []) {
            return $out;
        }
        $statement = Database::connection()->prepare(sprintf(
            'SELECT media_id, family, value, label FROM mar_media_tag WHERE media_id IN (%s) ORDER BY created_at, value',
            implode(', ', array_fill(0, count($ids), '?'))
        ));
        $statement->execute(array_values($ids));
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['media_id']][] = ['family' => (string) $row['family'], 'value' => (string) $row['value'], 'label' => $row['label'] !== null ? (string) $row['label'] : null];
        }

        return $out;
    }

    /**
     * Remplace les étiquettes d'une famille.
     *
     * @param array<string,?string> $values valeur → libellé
     */
    public function replaceTags(int $mediaId, string $family, array $values, int $userId): void
    {
        $pdo = Database::connection();
        $pdo->prepare('DELETE FROM mar_media_tag WHERE media_id = :m AND family = :f')->execute(['m' => $mediaId, 'f' => $family]);
        foreach ($values as $value => $label) {
            $this->addTag($mediaId, $family, (string) $value, $label, $userId);
        }
    }

    /** Ajoute une étiquette (sans effet si elle y est déjà). */
    public function addTag(int $mediaId, string $family, string $value, ?string $label, int $userId): void
    {
        Database::connection()->prepare(
            'INSERT IGNORE INTO mar_media_tag (media_id, family, value, label, created_by) VALUES (:m, :f, :v, :l, :u)'
        )->execute(['m' => $mediaId, 'f' => $family, 'v' => $value, 'l' => $label, 'u' => $userId > 0 ? $userId : null]);
    }

    public function hasTag(int $mediaId, string $family, ?string $value = null): bool
    {
        $statement = Database::connection()->prepare(
            'SELECT 1 FROM mar_media_tag WHERE media_id = :m AND family = :f' . ($value !== null ? ' AND value = :v' : '') . ' LIMIT 1'
        );
        $statement->execute(['m' => $mediaId, 'f' => $family] + ($value !== null ? ['v' => $value] : []));

        return $statement->fetchColumn() !== false;
    }

    // --- Propositions ------------------------------------------------------------

    /** Les propositions en attente sur les fichiers de la médiathèque (hors retirés). */
    public function pendingTotal(): int
    {
        return (int) Database::connection()->query(
            "SELECT COUNT(*) FROM mar_media_tag_proposal p JOIN mar_media m ON m.id = p.media_id
              WHERE p.status = 'proposed' AND m.archived_at IS NULL"
        )->fetchColumn();
    }

    /**
     * @param list<int> $ids
     * @return array<int,int> fichier → propositions en attente
     */
    public function pendingCounts(array $ids): array
    {
        $out = array_fill_keys($ids, 0);
        if ($ids === []) {
            return $out;
        }
        $statement = Database::connection()->prepare(sprintf(
            "SELECT media_id, COUNT(*) AS n FROM mar_media_tag_proposal WHERE status = 'proposed' AND media_id IN (%s) GROUP BY media_id",
            implode(', ', array_fill(0, count($ids), '?'))
        ));
        $statement->execute(array_values($ids));
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['media_id']] = (int) $row['n'];
        }

        return $out;
    }

    /**
     * Une page des fichiers qui ont des propositions en attente, les plus récemment proposés d'abord.
     *
     * @return array{rows:list<array<string,mixed>>, total:int}
     */
    public function proposalMediaPage(int $page, int $perPage, ?int $mediaId = null): array
    {
        $pdo   = Database::connection();
        $only  = $mediaId !== null ? ' AND m.id = :media' : '';
        $count = $pdo->prepare(
            "SELECT COUNT(DISTINCT p.media_id) FROM mar_media_tag_proposal p JOIN mar_media m ON m.id = p.media_id
              WHERE p.status = 'proposed' AND m.archived_at IS NULL" . $only
        );
        $count->execute($mediaId !== null ? ['media' => $mediaId] : []);
        $total = (int) $count->fetchColumn();

        $statement = $pdo->prepare(self::SELECT
            . " JOIN (SELECT media_id, MAX(id) AS last_id FROM mar_media_tag_proposal WHERE status = 'proposed' GROUP BY media_id) pp ON pp.media_id = m.id"
            . ' WHERE m.archived_at IS NULL' . $only . ' ORDER BY pp.last_id DESC LIMIT :limit OFFSET :offset');
        if ($mediaId !== null) {
            $statement->bindValue('media', $mediaId, PDO::PARAM_INT);
        }
        $statement->bindValue('limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue('offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $statement->execute();

        return ['rows' => $statement->fetchAll(), 'total' => $total];
    }

    /**
     * Les propositions de plusieurs fichiers, par fichier.
     *
     * @param list<int> $ids
     * @return array<int, list<array<string,mixed>>>
     */
    public function proposalsFor(array $ids, string $status = 'proposed'): array
    {
        $out = array_fill_keys($ids, []);
        if ($ids === []) {
            return $out;
        }
        $statement = Database::connection()->prepare(sprintf(
            "SELECT * FROM mar_media_tag_proposal WHERE status = ? AND media_id IN (%s)
              ORDER BY FIELD(family, 'produit', 'moment', 'saison', 'usage', 'detouree'), id",
            implode(', ', array_fill(0, count($ids), '?'))
        ));
        $statement->execute(array_merge([$status], array_values($ids)));
        foreach ($statement->fetchAll() as $row) {
            $out[(int) $row['media_id']][] = $row;
        }

        return $out;
    }

    /** @return array<string,mixed>|null */
    public function findProposal(int $id): ?array
    {
        $statement = Database::connection()->prepare('SELECT * FROM mar_media_tag_proposal WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /** Une proposition nouvelle ; `false` si la même valeur a déjà été proposée (en attente, acceptée ou refusée). */
    public function insertProposal(int $mediaId, string $family, string $value, ?string $label, string $reason, int $userId): bool
    {
        $statement = Database::connection()->prepare(
            'INSERT IGNORE INTO mar_media_tag_proposal (media_id, family, value, label, reason, created_by)
             VALUES (:m, :f, :v, :l, :r, :u)'
        );
        $statement->execute(['m' => $mediaId, 'f' => $family, 'v' => $value, 'l' => $label, 'r' => $reason, 'u' => $userId > 0 ? $userId : null]);

        return $statement->rowCount() > 0;
    }

    /** Tranche une proposition en attente ; `false` si elle ne l'était plus. */
    public function decideProposal(int $id, string $status, int $userId): bool
    {
        $statement = Database::connection()->prepare(
            "UPDATE mar_media_tag_proposal SET status = :s, decided_by = :u, decided_at = CURRENT_TIMESTAMP
              WHERE id = :id AND status = 'proposed'"
        );
        $statement->execute(['s' => $status, 'u' => $userId > 0 ? $userId : null, 'id' => $id]);

        return $statement->rowCount() > 0;
    }

    /**
     * Une famille choisie à la main clôt ses propositions en attente : acceptées pour les valeurs
     * retenues, refusées pour les autres.
     *
     * @param list<string> $kept
     */
    public function closeProposals(int $mediaId, string $family, array $kept, int $userId): void
    {
        $pending = $this->proposalsFor([$mediaId])[$mediaId] ?? [];
        foreach ($pending as $row) {
            if ((string) $row['family'] === $family) {
                $this->decideProposal((int) $row['id'], in_array((string) $row['value'], $kept, true) ? 'accepted' : 'refused', $userId);
            }
        }
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
        // Les images qu'une boutique peut prendre : celles du réseau (sans boutique) et les siennes.
        if (array_key_exists('shopOrNetwork', $filters)) {
            $where[] = '(m.shop_id IS NULL OR m.shop_id = :f_shopOrNetwork)';
            $params['f_shopOrNetwork'] = $filters['shopOrNetwork'];
        }
        // Les étiquettes : l'image porte cette valeur dans la famille.
        foreach (['moment' => 'moment', 'usage' => 'usage', 'product' => 'produit', 'tag' => 'libre'] as $key => $family) {
            if (array_key_exists($key, $filters)) {
                $where[] = sprintf('EXISTS (SELECT 1 FROM mar_media_tag ft WHERE ft.media_id = m.id AND ft.family = \'%s\' AND ft.value = :f_%s)', $family, $key);
                $params['f_' . $key] = $filters[$key];
            }
        }
        // Le format se lit dans la taille : carré à 5 % près.
        $format = [
            'carre'    => 'm.height > 0 AND m.width / m.height BETWEEN 0.95 AND 1.05',
            'paysage'  => 'm.height > 0 AND m.width / m.height > 1.05',
            'portrait' => 'm.height > 0 AND m.width / m.height < 0.95',
        ];
        if (isset($filters['format'], $format[$filters['format']])) {
            $where[] = $format[$filters['format']];
        }
        // Encore valable aujourd'hui (sans fin de validité, ou pas encore passée) — ou déjà passée.
        if (($filters['valid'] ?? null) === true) {
            $where[] = '(m.valid_until IS NULL OR m.valid_until >= CURRENT_DATE)';
        } elseif (($filters['valid'] ?? null) === false) {
            $where[] = 'm.valid_until < CURRENT_DATE';
        }
        if (($filters['categoryIsNull'] ?? null) === true) {
            $where[] = 'm.category_code IS NULL';
        } elseif (($filters['categoryIsNull'] ?? null) === false) {
            $where[] = 'm.category_code IS NOT NULL';
        }

        // Chaque mot doit se trouver dans le nom, la catégorie, la sous-catégorie, le produit ou une étiquette.
        $words = preg_split('/\s+/', trim((string) ($filters['name'] ?? '')), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach (array_slice($words, 0, 6) as $i => $word) {
            // Préparations natives : un paramètre nommé ne sert qu'une fois, d'où trois noms par mot.
            $key = 'q' . $i;
            $where[] = sprintf(
                '(m.name LIKE :%1$sa OR EXISTS (SELECT 1 FROM mar_media_category qc WHERE qc.code IN (m.category_code, m.subcategory_code) AND qc.label LIKE :%1$sb)'
                . ' OR EXISTS (SELECT 1 FROM mar_offer_item qi WHERE qi.id = m.offer_item_id AND qi.name LIKE :%1$sc)'
                . ' OR EXISTS (SELECT 1 FROM mar_media_tag qt WHERE qt.media_id = m.id AND (qt.value LIKE :%1$sd OR qt.label LIKE :%1$se)))',
                $key
            );
            $like = '%' . addcslashes($word, '%_\\') . '%';
            $params[$key . 'a'] = $like;
            $params[$key . 'b'] = $like;
            $params[$key . 'c'] = $like;
            $params[$key . 'd'] = $like;
            $params[$key . 'e'] = $like;
        }

        return [implode(' AND ', $where), $params];
    }
}
