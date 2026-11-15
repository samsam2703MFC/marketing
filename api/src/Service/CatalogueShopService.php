<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\CatalogueRepository;
use Marketing\Repository\CatalogueShopRepository;
use Marketing\Support\Keys;

/**
 * L'assistant du franchisé (maquettes B1-B4, 15/11/2026) : ce qu'une boutique fait d'un catalogue une fois qu'il est
 * composé — Vérifier · Imprimer · Diffuser —, et les catalogues que la marque prépare pour elle.
 *
 *  - Vérifier : des points CALCULÉS ici à partir du document (pages vides, produits sans photo, disponibilité,
 *    dates de promotion, prix, QR, adresse, pages de la marque), chacun avec ses gestes ; ceux que la boutique a vus
 *    sont retenus (`mar_catalogue_shop.checks_seen`).
 *  - Imprimer : « Marquer imprimé · N ex. » note la quantité et FIGE la version publiée de la charte : ce catalogue
 *    garde ses pages de la marque même si la marque publie une autre version.
 *  - Diffuser : le lien PERMANENT du catalogue en ligne (QR, affiche) — un jeton signé, rangé pour être révoqué
 *    (« Nouveau lien ») ; la page publique suit la dernière version du catalogue.
 *  - Un catalogue de la MARQUE préparé pour plusieurs boutiques (prêt ou imprimé) arrive dans le dashboard de chacune
 *    « Nouveau · de la marque » : « Le prendre tel quel » (il reste celui de la marque, à ses prix, sa version) ou
 *    « L'adapter à ma boutique » (une copie à elle, que la marque ne modifie plus).
 *
 * Le périmètre de la boutique est celui du chemin (identifiant de caisse lu par le contrôleur) ; les dépôts
 * l'appliquent : un catalogue d'une autre boutique, ou de la marque qui ne la vise pas, n'est jamais trouvé.
 */
final class CatalogueShopService
{
    /** Le préfixe d'un code de point de vérification (`page-vide-7`, `promo-bundle-12`…). */
    private const CHECK_CODE = '/^[a-z0-9-]{1,60}$/';

    private const RECEPTIONS = ['nouveau', 'pris', 'adapte'];

    public function __construct(
        private readonly CatalogueService $catalogues = new CatalogueService(),
        private readonly CatalogueRepository $rows = new CatalogueRepository(),
        private readonly CatalogueShopRepository $repo = new CatalogueShopRepository(),
    ) {
    }

    // ---------------------------------------------------------------------------------------------
    // Catalogues de la marque reçus
    // ---------------------------------------------------------------------------------------------

    /** @return array{items: list<array<string,mixed>>, total:int} */
    public function received(array $shop, int $page, int $perPage): array
    {
        $result = $this->repo->received($shop['id'], $page, $perPage);
        $items = [];
        foreach ($result['items'] as $id) {
            $row = $this->rows->find($id);
            if ($row !== null) {
                $items[] = $this->serialize($row, $shop);
            }
        }

        return ['items' => $items, 'total' => $result['total']];
    }

    /** Un catalogue de la marque préparé pour la boutique ; null sinon (autre boutique, brouillon, inconnu). */
    public function findReceived(int $id, array $shop): ?array
    {
        return $this->repo->received($shop['id'], 1, 1, $id)['items'] === [] ? null : $this->rows->find($id);
    }

    /** Un catalogue (le sien ou de la marque) vu par la boutique : celui du catalogue, plus ce qu'elle en a fait. */
    public function serialize(array $row, array $shop): array
    {
        $out = $this->catalogues->serialize($row);
        $state = $this->repo->state((int) $row['id'], $shop['id']);
        $brand = $row['owner'] === 'marque';
        $out['reception'] = $brand ? [
            'status'     => $state['reception'] ?? 'nouveau',
            'adaptedId'  => $state['adaptedId'] ?? null,
            'receivedAt' => gmdate('Y-m-d\TH:i:s\Z', (int) strtotime((string) $row['updated_at'])),
        ] : null;
        $out['print'] = $brand
            ? ['quantity' => $state['printQty'] ?? null, 'printedAt' => self::iso($state['printedAt'] ?? null), 'charterVersion' => $state['charterVersion'] ?? null]
            : ['quantity' => $row['print_qty'] !== null ? (int) $row['print_qty'] : null, 'printedAt' => null, 'charterVersion' => isset($row['charter_version']) ? (int) $row['charter_version'] : null];
        if (!$brand && $state !== null && $state['printedAt'] !== null) {
            $out['print']['printedAt'] = self::iso($state['printedAt']);
        }

        return $out;
    }

    /** « Le prendre tel quel » : il devient visible dans sa liste. Idempotent. */
    public function receive(array $row, array $shop, array $input): array
    {
        $errors = [];
        foreach (array_keys($input) as $key) {
            if ($key !== 'status') {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }
        $status = $input['status'] ?? null;
        if (!in_array($status, ['nouveau', 'pris'], true)) {
            $errors[] = ['field' => 'status', 'message' => 'Attendu : pris (le prendre tel quel) ou nouveau (le remettre en proposition).'];
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Réception invalide.', 422, $errors);
        }
        $state = $this->repo->state((int) $row['id'], $shop['id']);
        if (($state['reception'] ?? null) === 'adapte') {
            throw new CatalogueError('CATALOGUE_ALREADY_ADAPTED', 'Ce catalogue a déjà été adapté : la boutique travaille sur sa copie.', 409, [['field' => 'status', 'message' => 'Copie n° ' . ($state['adaptedId'] ?? '?') . '.']]);
        }
        $this->repo->putState((int) $row['id'], $shop['id'], ['reception' => $status]);

        return $this->serialize((array) $this->rows->find((int) $row['id']), $shop);
    }

    /**
     * « L'adapter à ma boutique » : une copie à elle (propriétaire boutique), que la marque ne modifie plus — mêmes
     * pages, mêmes réglages, ses produits seulement (ceux qu'elle ne vend pas sont retirés). Idempotent : un second
     * appel rend la même copie (`created` faux).
     *
     * @return array{catalogue: array<string,mixed>, created: bool, removed: list<int>}
     */
    public function adapt(array $row, array $shop): array
    {
        $state = $this->repo->state((int) $row['id'], $shop['id']);
        if (($state['reception'] ?? null) === 'adapte' && $state['adaptedId'] !== null) {
            $copy = $this->rows->find($state['adaptedId'], $shop['id']);
            if ($copy !== null) {
                return ['catalogue' => $this->serialize($copy, $shop), 'created' => false, 'removed' => []];
            }
        }
        $known = array_column($this->catalogues->webshopProducts([$shop])['products'], null, 'id');
        $settings = $row['settings'];
        $kept = [];
        $removed = [];
        foreach ((array) ($settings['products'] ?? []) as $product) {
            if (isset($known[(int) ($product['id'] ?? 0)])) {
                $kept[] = ['id' => (int) $product['id'], 'on' => (bool) ($product['on'] ?? true)];
            } else {
                $removed[] = (int) ($product['id'] ?? 0);
            }
        }
        // Une photo de la place libre prise dans la médiathèque d'une autre boutique ne la suit pas : l'illustration.
        $pages = array_map(static function ($page): mixed {
            if (is_array($page) && isset($page['fillerMediaId'])) {
                unset($page['fillerMediaId']);
                $page['filler'] = 'illustration';
            }

            return $page;
        }, CatalogueService::innerPages($settings));
        $copy = [
            'title'        => (string) $row['title'],
            'owner'        => 'boutique',
            'shop_id'      => $shop['id'],
            'source_kind'  => $row['source_kind'] === 'campagne' ? 'choix' : (string) $row['source_kind'],
            'source_ref'   => $row['source_kind'] === 'campagne' ? null : $row['source_ref'],
            'source_label' => $row['source_label'],
            'format'       => (string) $row['format'],
            'status'       => 'brouillon',
            'print_qty'    => null,
            'settings'     => [
                'langs'            => array_values($settings['langs'] ?? ['fr']),
                'shopIds'          => [],
                'pageCount'        => CatalogueService::pageCountOf($settings),
                'products'         => $kept,
                'pages'            => $pages,
                'offers'           => array_values($settings['offers'] ?? []),
                'showAvailability' => (bool) ($settings['showAvailability'] ?? true),
                'adaptedFrom'      => (int) $row['id'],
            ],
        ];
        $id = $this->rows->insert($copy, null);
        $this->repo->putState((int) $row['id'], $shop['id'], ['reception' => 'adapte', 'adapted_id' => $id]);

        return ['catalogue' => $this->serialize((array) $this->rows->find($id, $shop['id']), $shop), 'created' => true, 'removed' => $removed];
    }

    // ---------------------------------------------------------------------------------------------
    // Le document vu par la boutique
    // ---------------------------------------------------------------------------------------------

    /** Le document de la boutique : sa version d'un catalogue de la marque, la charte figée à son impression. */
    public function document(array $row, array $shop, string $lang): array
    {
        if ($row['owner'] === 'marque') {
            $state = $this->repo->state((int) $row['id'], $shop['id']);

            return $this->catalogues->document($row, $shop['id'], $lang, ($state['printedAt'] ?? null) !== null ? ($state['charterVersion'] ?? null) : null);
        }

        return $this->catalogues->document($row, null, $lang);
    }

    // ---------------------------------------------------------------------------------------------
    // Vérifier (maquette B1)
    // ---------------------------------------------------------------------------------------------

    /**
     * Les points à voir avant d'imprimer, calculés à partir du document : chacun `{code, level, title, text, page,
     * actions, seen}`. `level` : `alerte` (quelque chose s'imprimera mal), `question` (à confirmer), `ok` (vu d'office).
     * `actions` : les gestes que l'écran propose (codes stables).
     *
     * @return array{items: list<array<string,mixed>>, seen:int, total:int, pages: list<array<string,mixed>>}
     */
    public function checks(array $row, array $shop, string $lang): array
    {
        $doc = $this->document($row, $shop, $lang);
        $brand = $row['owner'] === 'marque';
        $pages = $doc['pages'];
        $codes = array_column($doc['warnings'], 'message', 'code');
        $items = [];
        $marks = [];

        foreach ($pages as $index => $page) {
            $no = $index + 1;
            if (($page['kind'] ?? '') === 'products' && ($page['products'] ?? []) === []) {
                $items[] = self::point('page-vide-' . $no, 'alerte', sprintf('Page %d sans produit', $no),
                    sprintf('Elle s’imprimera vide. Ajoutez des produits, changez sa catégorie, ou passez à %d pages.', max(8, count($pages) - 2)),
                    $no, $brand ? ['ouvrir-page'] : ['ouvrir-page', 'moins-de-pages']);
                $marks[$no] = 'alerte';
            }
        }

        $noPhoto = [];
        $noPrice = [];
        $promos = [];
        foreach ($pages as $index => $page) {
            foreach ($page['products'] ?? [] as $item) {
                if (($item['kind'] ?? 'product') === 'offer') {
                    if (($item['period'] ?? null) !== null) {
                        $promos[(string) $item['id']] = ['name' => (string) $item['name'], 'period' => (string) $item['period'], 'page' => $index + 1, 'type' => $item['type'] ?? '', 'erpId' => $item['erpId'] ?? null];
                    }
                    continue;
                }
                if (($item['imageUrl'] ?? null) === null) {
                    $noPhoto[(int) $item['id']] = (string) $item['name'];
                    $marks[$index + 1] ??= 'alerte';
                }
                if (($item['priceCents'] ?? null) === null) {
                    $noPrice[(int) $item['id']] = (string) $item['name'];
                }
            }
        }
        if ($noPhoto !== []) {
            $items[] = self::point('sans-photo', 'alerte', sprintf('%d produit%s sans photo', count($noPhoto), count($noPhoto) > 1 ? 's' : ''),
                implode(', ', array_slice($noPhoto, 0, 6)) . (count($noPhoto) > 6 ? '…' : '') . ' : le dessin de la famille est imprimé à la place de la photo (la photo vient du webshop).',
                null, ['imprimer-ainsi']);
        }

        $shown = 0;
        foreach ($pages as $index => $page) {
            $foot = $page['availabilityFooter'] ?? null;
            if (is_string($foot) && $foot !== '' && $shown < 4) {
                $shown++;
                $items[] = self::point('dispo-' . ($index + 1), 'question', 'Disponibilité en pied de page',
                    sprintf('Page %d · %s : « %s » — est-ce juste pour ma boutique ?', $index + 1, (string) ($page['title'] ?? ''), $foot),
                    $index + 1, $brand ? ['c-est-juste'] : ['c-est-juste', 'modifier']);
                $marks[$index + 1] ??= 'question';
            }
        }

        foreach (array_slice($promos, 0, 4, true) as $id => $promo) {
            $items[] = self::point('promo-' . preg_replace('/[^a-z0-9-]/', '', strtolower($id)), 'question', sprintf('Promotion « %s »', $promo['name']),
                sprintf('Imprimée page %d avec ses dates : %s. Le catalogue sera-t-il distribué après la fin de la promotion ?', $promo['page'], $promo['period']),
                $promo['page'], $brand ? ['dates-vues'] : ['dates-vues', 'retirer-promo'], ['offer' => ['type' => $promo['type'], 'id' => $promo['erpId']]]);
            $marks[$promo['page']] ??= 'question';
        }

        // Prix : celui du webshop de la boutique ; un prix au comptoir différent est dit.
        $differs = [];
        try {
            foreach ($this->catalogues->webshopProducts([$shop])['products'] as $product) {
                $mine = $product['prices'][0] ?? null;
                if ($mine !== null && $mine['webPriceCents'] !== null && $mine['shopPriceCents'] !== null && $mine['webPriceCents'] !== $mine['shopPriceCents']) {
                    $differs[(int) $product['id']] = (string) $product['name'];
                }
            }
        } catch (\Throwable) {
            $differs = [];
        }
        $inDoc = [];
        foreach ($pages as $page) {
            foreach ($page['products'] ?? [] as $item) {
                if (($item['kind'] ?? 'product') !== 'offer') {
                    $inDoc[(int) $item['id']] = true;
                }
            }
        }
        $differs = array_intersect_key($differs, $inDoc);
        if ($noPrice !== []) {
            $items[] = self::point('prix', 'alerte', 'Prix manquants', sprintf('%s : pas de prix au webshop de ma boutique, « — » est imprimé.', implode(', ', array_slice($noPrice, 0, 6))), null, ['imprimer-ainsi']);
        } elseif ($differs !== []) {
            $items[] = self::point('prix', 'question', 'Prix différents au comptoir', sprintf('%s : le catalogue imprime le prix du webshop, le comptoir en a un autre.', implode(', ', array_slice($differs, 0, 6))), null, ['c-est-juste']);
        } else {
            $items[] = self::point('prix', 'ok', 'Prix', sprintf('Les %d produits ont un prix au webshop de ma boutique. Un prix différent au comptoir serait signalé ici.', count($inDoc)), null, []);
        }

        $version = $doc['charter']['version'] ?? null;
        $printed = $row['status'] === 'imprime' || ($brand && ($this->repo->state((int) $row['id'], $shop['id'])['printedAt'] ?? null) !== null);
        $items[] = self::point('pages-marque', 'ok', 'Pages de la marque',
            'Couverture, page 2, avant-dernière, dernière : ' . ($version === null ? 'la charte de la marque.' : sprintf('version %d de la charte (publiée par la marque)%s.', $version,
                $printed ? ', figée à l’impression' : '')),
            null, []);

        if (isset($codes['WEBSHOP_URL_UNKNOWN'])) {
            $items[] = self::point('qr', 'alerte', 'Pas de QR code sur la dernière page', 'L’adresse du webshop n’est pas réglée : c’est la marque qui la règle, elle est prévenue. Vous pouvez imprimer sans QR ou attendre.', count($pages), ['regle-par-la-marque']);
            $marks[count($pages)] = 'alerte';
        }
        if (isset($codes['SHOP_ADDRESS_MISSING'])) {
            $items[] = self::point('adresse', 'alerte', 'Adresse de la boutique inconnue', 'TFBuddy ne donne pas l’adresse de ma boutique : la dernière page s’imprime sans elle. Elle se corrige dans l’ERP.', count($pages), ['regle-par-la-marque']);
            $marks[count($pages)] ??= 'alerte';
        }
        if ($lang === 'nl' && isset($codes['NL_TEXT_MISSING'])) {
            $items[] = self::point('nl', 'alerte', 'Textes néerlandais manquants', 'Une page de la marque n’a pas encore sa version néerlandaise : le français est imprimé.', null, ['regle-par-la-marque']);
        }

        $seenCodes = $this->repo->state((int) $row['id'], $shop['id'])['checksSeen'] ?? [];
        $seen = 0;
        foreach ($items as &$item) {
            $item['seen'] = $item['level'] === 'ok' || in_array($item['code'], $seenCodes, true);
            $seen += $item['seen'] ? 1 : 0;
        }
        unset($item);

        $thumbs = [];
        foreach ($pages as $index => $page) {
            $thumbs[] = ['no' => $index + 1, 'kind' => (string) $page['kind'], 'mark' => $marks[$index + 1] ?? null];
        }

        return ['items' => $items, 'seen' => $seen, 'total' => count($items), 'pages' => $thumbs, 'lang' => $lang];
    }

    /** « Vu » (ou plus vu) : un point de vérification. Idempotent. */
    public function markSeen(array $row, array $shop, string $code, array $input): array
    {
        $errors = [];
        foreach (array_keys($input) as $key) {
            if ($key !== 'seen') {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }
        if (!is_bool($input['seen'] ?? null)) {
            $errors[] = ['field' => 'seen', 'message' => 'Booléen attendu.'];
        }
        if (preg_match(self::CHECK_CODE, $code) !== 1) {
            $errors[] = ['field' => 'code', 'message' => 'Code de point inconnu.'];
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Point de vérification invalide.', 422, $errors);
        }
        $seen = $this->repo->state((int) $row['id'], $shop['id'])['checksSeen'] ?? [];
        $seen = array_values(array_diff($seen, [$code]));
        if ($input['seen']) {
            $seen[] = $code;
        }
        $this->repo->putState((int) $row['id'], $shop['id'], ['checks_seen' => array_slice($seen, -100)]);

        return ['code' => $code, 'seen' => $input['seen']];
    }

    // ---------------------------------------------------------------------------------------------
    // Imprimer (maquette B2)
    // ---------------------------------------------------------------------------------------------

    /**
     * « Marquer imprimé · N ex. » : la quantité, la date, et la version de la charte FIGÉE (celle publiée maintenant).
     * Son catalogue passe « Imprimé » ; un catalogue de la marque garde l'impression de CETTE boutique.
     *
     * @return array<string,mixed> Le catalogue tel que la boutique le voit.
     */
    public function recordPrint(array $row, array $shop, array $input): array
    {
        $errors = [];
        foreach (array_keys($input) as $key) {
            if ($key !== 'quantity') {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }
        $qty = $input['quantity'] ?? null;
        if (!is_int($qty) || $qty < 1 || $qty > 1000000) {
            $errors[] = ['field' => 'quantity', 'message' => 'Nombre d’exemplaires entre 1 et 1 000 000.'];
        }
        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Impression invalide.', 422, $errors);
        }
        $version = $this->catalogues->publishedVersion();
        $now = gmdate('Y-m-d H:i:s');
        if ($row['owner'] === 'boutique') {
            $this->catalogues->update($row, ['status' => 'imprime', 'printQty' => $qty], $shop['id'], null);
            $this->repo->putState((int) $row['id'], $shop['id'], ['print_qty' => $qty, 'printed_at' => $now, 'charter_version' => $version]);
        } else {
            $this->repo->putState((int) $row['id'], $shop['id'], ['print_qty' => $qty, 'printed_at' => $now, 'charter_version' => $version,
                'reception' => ($this->repo->state((int) $row['id'], $shop['id'])['reception'] ?? null) ?? 'pris']);
        }

        return $this->serialize((array) $this->rows->find((int) $row['id']), $shop);
    }

    // ---------------------------------------------------------------------------------------------
    // Diffuser (maquette B3) : le lien permanent
    // ---------------------------------------------------------------------------------------------

    /** @return array<string,mixed>|null Le lien en cours, ou null. */
    public function currentLink(array $row, array $shop): ?array
    {
        $link = $this->repo->currentLink((int) $row['id'], $row['owner'] === 'marque' ? $shop['id'] : null);

        return $link === null ? null : $this->linkOut($link);
    }

    /** « Nouveau lien » (et le premier) : l'ancien ne mène plus nulle part. */
    public function renewLink(array $row, array $shop): array
    {
        if (strlen(self::secret()) < 32) {
            throw new CatalogueError('DEPENDENCY_UNAVAILABLE', 'MAR_SESSION_SECRET n’est pas renseigné : le lien ne peut pas être signé.', 503);
        }
        $nonce = self::b64(random_bytes(16));
        $id = $this->repo->renewLink((int) $row['id'], $row['owner'] === 'marque' ? $shop['id'] : null, $nonce);

        return $this->linkOut((array) $this->repo->link($id));
    }

    /**
     * Le catalogue d'un lien permanent valable : [catalogue, boutique de la version] ; null : inconnu, révoqué,
     * falsifié, ou catalogue supprimé.
     *
     * @return array{0: array<string,mixed>, 1: ?int}|null
     */
    public function readLink(string $token): ?array
    {
        if (preg_match('/^([0-9]{1,12})-([A-Za-z0-9_-]{22})-([A-Za-z0-9_-]{43})$/', $token, $m) !== 1 || strlen(self::secret()) < 32) {
            return null;
        }
        $signature = hash_hmac('sha256', 'catalogue-lien:' . $m[1] . '.' . $m[2], self::secret(), true);
        if (!hash_equals(self::b64($signature), $m[3])) {
            return null;
        }
        $link = $this->repo->link((int) $m[1]);
        if ($link === null || $link['revokedAt'] !== null || !hash_equals($link['nonce'], $m[2])) {
            return null;
        }
        $row = $this->rows->find($link['catalogueId']);

        return $row === null ? null : [$row, $link['shopId']];
    }

    /** Le document d'un lien permanent : la dernière version du catalogue (pour la boutique d'un catalogue de la marque). */
    public function linkDocument(array $row, ?int $shopId, string $lang): array
    {
        return $row['owner'] === 'marque' && $shopId !== null
            ? $this->catalogues->document($row, $shopId, $lang)
            : $this->catalogues->document($row, null, $lang);
    }

    private function linkOut(array $link): array
    {
        $payload = $link['id'] . '-' . $link['nonce'];
        $token = $payload . '-' . self::b64(hash_hmac('sha256', 'catalogue-lien:' . $link['id'] . '.' . $link['nonce'], self::secret(), true));

        return ['token' => $token, 'url' => CatalogueService::publicPage('l', $token), 'createdAt' => $link['createdAt']];
    }

    // ---------------------------------------------------------------------------------------------

    /** @param list<string> $actions */
    private static function point(string $code, string $level, string $title, string $text, ?int $page, array $actions, array $extra = []): array
    {
        return ['code' => $code, 'level' => $level, 'title' => $title, 'text' => $text, 'page' => $page, 'actions' => $actions] + $extra;
    }

    private static function secret(): string
    {
        return (string) (Keys::get('MAR_SESSION_SECRET') ?? '');
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function iso(?string $datetime): ?string
    {
        return $datetime === null ? null : gmdate('Y-m-d\TH:i:s\Z', (int) strtotime($datetime . ' UTC'));
    }
}
