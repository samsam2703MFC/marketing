<?php

declare(strict_types=1);

namespace Marketing\Service;

use Marketing\Repository\CatalogueOrderConditionsRepository;

/**
 * Le bon de commande d'un catalogue imprimé (maquette F, validée le 25/11/2026) : une feuille A4 (une seconde quand le
 * contenu déborde), FR ou NL, pour la version générale ou celle d'une boutique.
 *
 * Son contenu est EXACTEMENT celui du document du catalogue (`CatalogueService::document`) : rien n'est ressaisi ni
 * inventé. Les catégories sont les pages produits, dans leur ordre (deux pages au même titre font une catégorie, « pages
 * 3–4 ») ; les produits sont ceux que le catalogue imprime, à son prix (celui de la version), avec la remise programmée
 * qui le barre et sa période ; les offres (bundles, « 2+1 »…) sont les vignettes du catalogue, avec leur contenu et leur
 * période « du … au … » ; la disponibilité de chaque catégorie est son pied de page.
 *
 * Ce que le catalogue ne dit pas, la boutique le règle une fois dans son dashboard (`mar_catalogue_order_conditions`) :
 * délai minimum (jamais plus court que celui du catalogue : le pied de chaque catégorie imprime le plus long des deux),
 * acompte, dates limites des fêtes, retrait, livraison, mention libre. Rien de réglé, ou la version générale : le cadre
 * des conditions s'imprime vide, à remplir à la main — le bon n'est jamais bloqué.
 */
final class CatalogueOrderFormService
{
    public const LEAD_UNITS = ['hours', 'days'];
    private const LEAD_MAX = ['hours' => 720, 'days' => 60];
    private const DEADLINES_MAX = 10;
    private const NOTE_MAX = 160;
    private const RADIUS_MAX = 200;
    private const FEE_MAX = 100_000;

    public function __construct(
        private readonly CatalogueService $catalogues = new CatalogueService(),
        private readonly CatalogueOrderConditionsRepository $conditions = new CatalogueOrderConditionsRepository(),
    ) {
    }

    // ---------------------------------------------------------------------------------------------
    // Les conditions d'une boutique
    // ---------------------------------------------------------------------------------------------

    /** Les conditions de la boutique ; `configured: false` et des valeurs vides si elle n'a rien réglé. @return array<string,mixed> */
    public function conditionsOf(int $shopId): array
    {
        $row = $this->conditions->find($shopId);

        return $row === null ? self::emptyConditions($shopId) : self::conditionsOut($row);
    }

    /** @return array{items: list<array<string,mixed>>, total:int} */
    public function conditionsPage(int $page, int $perPage): array
    {
        $result = $this->conditions->page($page, $perPage);

        return ['items' => array_map(self::conditionsOut(...), $result['items']), 'total' => $result['total']];
    }

    /**
     * Enregistre les conditions de la boutique (elles valent pour tous ses bons). Le corps entier, validé ; un champ
     * absent prend sa valeur vide. 422 au moindre champ illisible : rien n'est écrit.
     *
     * @param array<string,mixed> $input
     * @return array<string,mixed>
     */
    public function saveConditions(int $shopId, array $input): array
    {
        $errors = [];
        foreach (array_keys($input) as $key) {
            if (!in_array($key, ['minDelay', 'depositPct', 'holidayDeadlines', 'pickup', 'delivery', 'note'], true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }
        $c = self::emptyConditions($shopId);

        $delay = $input['minDelay'] ?? null;
        if ($delay !== null) {
            if (!is_array($delay) || array_diff(array_keys($delay), ['value', 'unit']) !== []) {
                $errors[] = ['field' => 'minDelay', 'message' => '{value, unit} ou null.'];
            } elseif (!in_array($delay['unit'] ?? null, self::LEAD_UNITS, true)) {
                $errors[] = ['field' => 'minDelay.unit', 'message' => 'hours ou days.'];
            } elseif (!is_int($delay['value'] ?? null) || $delay['value'] < 1 || $delay['value'] > self::LEAD_MAX[$delay['unit']]) {
                $errors[] = ['field' => 'minDelay.value', 'message' => sprintf('Entier de 1 à %d.', self::LEAD_MAX[$delay['unit']])];
            } else {
                $c['minDelay'] = ['value' => $delay['value'], 'unit' => $delay['unit']];
            }
        }

        $deposit = $input['depositPct'] ?? null;
        if ($deposit !== null) {
            if (!is_int($deposit) || $deposit < 0 || $deposit > 100) {
                $errors[] = ['field' => 'depositPct', 'message' => 'Entier de 0 à 100, ou null.'];
            } else {
                $c['depositPct'] = $deposit;
            }
        }

        $deadlines = $input['holidayDeadlines'] ?? [];
        if (!is_array($deadlines) || !array_is_list($deadlines) || count($deadlines) > self::DEADLINES_MAX) {
            $errors[] = ['field' => 'holidayDeadlines', 'message' => sprintf('Liste de %d dates au plus.', self::DEADLINES_MAX)];
        } else {
            foreach ($deadlines as $i => $d) {
                $field = 'holidayDeadlines[' . $i . ']';
                if (!is_array($d) || array_diff(array_keys($d), ['for', 'until']) !== []) {
                    $errors[] = ['field' => $field, 'message' => '{for, until} attendu.'];
                    continue;
                }
                $for = self::date($d['for'] ?? null);
                $until = self::date($d['until'] ?? null);
                if ($for === null) {
                    $errors[] = ['field' => $field . '.for', 'message' => 'Date AAAA-MM-JJ attendue.'];
                } elseif ($until === null) {
                    $errors[] = ['field' => $field . '.until', 'message' => 'Date AAAA-MM-JJ attendue.'];
                } elseif ($until > $for) {
                    $errors[] = ['field' => $field . '.until', 'message' => 'Le dernier jour de commande vient avant (ou le jour même de) la date de la fête.'];
                } else {
                    $c['holidayDeadlines'][] = ['for' => $for, 'until' => $until];
                }
            }
            usort($c['holidayDeadlines'], static fn (array $a, array $b): int => [$a['for'], $a['until']] <=> [$b['for'], $b['until']]);
        }

        $pickup = $input['pickup'] ?? true;
        if (!is_bool($pickup)) {
            $errors[] = ['field' => 'pickup', 'message' => 'Booléen attendu.'];
        } else {
            $c['pickup'] = $pickup;
        }

        $delivery = $input['delivery'] ?? null;
        if ($delivery !== null) {
            if (!is_array($delivery) || array_diff(array_keys($delivery), ['enabled', 'radiusKm', 'feeCents']) !== []) {
                $errors[] = ['field' => 'delivery', 'message' => '{enabled, radiusKm, feeCents} attendu.'];
            } elseif (!is_bool($delivery['enabled'] ?? null)) {
                $errors[] = ['field' => 'delivery.enabled', 'message' => 'Booléen attendu.'];
            } else {
                $radius = $delivery['radiusKm'] ?? null;
                $fee = $delivery['feeCents'] ?? null;
                if ($radius !== null && (!is_int($radius) || $radius < 1 || $radius > self::RADIUS_MAX)) {
                    $errors[] = ['field' => 'delivery.radiusKm', 'message' => sprintf('Entier de 1 à %d, ou null.', self::RADIUS_MAX)];
                } elseif ($fee !== null && (!is_int($fee) || $fee < 0 || $fee > self::FEE_MAX)) {
                    $errors[] = ['field' => 'delivery.feeCents', 'message' => 'Montant en centimes (0 à 100 000), ou null.'];
                } else {
                    $c['delivery'] = ['enabled' => $delivery['enabled'], 'radiusKm' => $delivery['enabled'] ? $radius : null, 'feeCents' => $delivery['enabled'] ? $fee : null];
                }
            }
        }
        if (!$c['pickup'] && !$c['delivery']['enabled'] && !array_filter($errors, static fn (array $e): bool => in_array($e['field'], ['pickup', 'delivery', 'delivery.enabled'], true))) {
            $errors[] = ['field' => 'pickup', 'message' => 'Le retrait ou la livraison, au moins l’un des deux.'];
        }

        $note = $input['note'] ?? ['fr' => '', 'nl' => ''];
        if (!is_array($note) || array_diff(array_keys($note), ['fr', 'nl']) !== []) {
            $errors[] = ['field' => 'note', 'message' => '{fr, nl} attendu.'];
        } else {
            foreach (['fr', 'nl'] as $l) {
                $text = $note[$l] ?? '';
                if (!is_string($text) || mb_strlen(trim($text)) > self::NOTE_MAX || preg_match('/[\r\n]/', $text) === 1) {
                    $errors[] = ['field' => 'note.' . $l, 'message' => sprintf('Une ligne, %d caractères au plus.', self::NOTE_MAX)];
                } else {
                    $c['note'][$l] = trim($text);
                }
            }
        }

        if ($errors !== []) {
            throw new CatalogueError('VALIDATION_FAILED', 'Conditions du bon de commande invalides.', 422, $errors);
        }
        $this->conditions->save($shopId, $c);

        return $this->conditionsOf($shopId);
    }

    /** @return array<string,mixed> */
    private static function emptyConditions(int $shopId): array
    {
        return [
            'shopId'           => $shopId,
            'configured'       => false,
            'minDelay'         => null,
            'depositPct'       => null,
            'holidayDeadlines' => [],
            'pickup'           => true,
            'delivery'         => ['enabled' => false, 'radiusKm' => null, 'feeCents' => null],
            'note'             => ['fr' => '', 'nl' => ''],
            'updatedAt'        => null,
        ];
    }

    /** La forme publique d'une ligne : toujours les mêmes clés, dans le même ordre. @param array<string,mixed> $row @return array<string,mixed> */
    private static function conditionsOut(array $row): array
    {
        return [
            'shopId'           => $row['shopId'],
            'configured'       => true,
            'minDelay'         => $row['minDelay'],
            'depositPct'       => $row['depositPct'],
            'holidayDeadlines' => $row['holidayDeadlines'],
            'pickup'           => $row['pickup'],
            'delivery'         => $row['delivery'],
            'note'             => $row['note'],
            'updatedAt'        => gmdate('Y-m-d\TH:i:s\Z', (int) strtotime((string) $row['updatedAt'])),
        ];
    }

    private static function date(mixed $value): ?string
    {
        if (!is_string($value) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }

        return $value;
    }

    // ---------------------------------------------------------------------------------------------
    // Le bon
    // ---------------------------------------------------------------------------------------------

    /**
     * Le bon de commande d'une version d'un catalogue : la marque (`$versionShopId` : null = générale), ou une boutique
     * qui imprime le sien ou celui de la marque reçu (`$document` déjà composé pour elle).
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public function forVersion(array $row, ?int $versionShopId, string $lang, ?array $document = null): array
    {
        $doc = $document ?? $this->catalogues->document($row, $versionShopId, $lang);
        $shopId = $doc['version']['shop']['id'] ?? null;
        $conditions = $shopId !== null ? $this->conditions->find((int) $shopId) : null;

        return self::compose($doc, $this->catalogues->leadHours(), $conditions, $lang, $row);
    }

    /**
     * La composition, sans base ni réseau : le document du catalogue, le délai de chaque produit, les conditions de la
     * boutique (null : aucune). Toutes les clés dans un ordre fixe.
     *
     * @param array<string,mixed> $doc
     * @param array<int, ?int> $leadHours
     * @param array<string,mixed>|null $conditions
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public static function compose(array $doc, array $leadHours, ?array $conditions, string $lang, array $row = []): array
    {
        $nl = $lang === 'nl';
        $shopHours = null;
        if ($conditions !== null && $conditions['minDelay'] !== null) {
            $shopHours = $conditions['minDelay']['value'] * ($conditions['minDelay']['unit'] === 'days' ? 24 : 1);
        }

        $sections = [];
        $byTitle = [];
        $offers = [];
        $seenProducts = [];
        $back = null;
        foreach ($doc['pages'] as $i => $page) {
            $no = $i + 1;
            if (($page['kind'] ?? '') === 'back') {
                $back = $page;
            }
            if (!in_array($page['kind'] ?? '', ['products', 'presentation'], true) || ($page['products'] ?? []) === []) {
                continue;
            }
            $title = (string) $page['title'];
            if (($page['kind'] ?? '') === 'products' && ($page['gammeTitle'] ?? null) !== null && $page['gammeTitle'] !== '' && $page['gammeTitle'] !== $title) {
                $title = $page['gammeTitle'] . ' — ' . $title;
            }
            $key = mb_strtolower($title);
            foreach ($page['products'] as $item) {
                if (($item['kind'] ?? 'product') === 'offer') {
                    $id = (string) $item['id'];
                    if (!isset($offers[$id])) {
                        $offers[$id] = self::offerLine($item, $nl);
                    }
                    if (!in_array($no, $offers[$id]['pages'], true)) {
                        $offers[$id]['pages'][] = $no;
                    }
                    continue;
                }
                $pid = (int) $item['id'];
                if (isset($seenProducts[$pid])) {
                    continue;
                }
                $seenProducts[$pid] = true;
                if (!isset($byTitle[$key])) {
                    $byTitle[$key] = count($sections);
                    $sections[] = ['title' => $title, 'pages' => [], 'items' => [], 'footers' => [], 'lead' => null];
                }
                $s = &$sections[$byTitle[$key]];
                $s['items'][] = self::productLine($item, $nl);
                $lead = $leadHours[$pid] ?? null;
                if ($lead !== null && ($s['lead'] === null || $lead > $s['lead'])) {
                    $s['lead'] = $lead;
                }
                if (!in_array($no, $s['pages'], true)) {
                    $s['pages'][] = $no;
                }
                $footer = $page['availabilityFooter'] ?? null;
                if (is_string($footer) && $footer !== '' && !in_array($footer, $s['footers'], true)) {
                    $s['footers'][] = $footer;
                }
                unset($s);
            }
        }

        $categories = [];
        foreach ($sections as $s) {
            $categories[] = [
                'title'  => $s['title'],
                'pages'  => $s['pages'],
                'items'  => $s['items'],
                'footer' => self::footer($s['footers'], $s['lead'], $shopHours, $conditions['minDelay'] ?? null, $nl),
                'delay'  => self::delay($s['lead'], $shopHours, $conditions['minDelay'] ?? null, $nl),
            ];
        }
        $offerList = array_values($offers);
        $allPages = [];
        foreach ($categories as $c) {
            $allPages = array_merge($allPages, $c['pages']);
        }
        foreach ($offerList as $o) {
            $allPages = array_merge($allPages, $o['pages']);
        }
        $allPages = array_values(array_unique($allPages));
        sort($allPages);

        $shop = $doc['version']['shop'] ?? null;
        $qr = null;
        if ($back !== null && ($back['qrUrl'] ?? null) !== null) {
            $qr = [
                'url'   => (string) $back['qrUrl'],
                'host'  => $back['host'] ?? null,
                'label' => $nl ? 'Online bestellen' : 'Commander en ligne',
                'sub'   => $shop !== null ? ($nl ? 'De webshop van ' : 'Le webshop de ') . $shop['name'] : (string) ($back['host'] ?? ''),
            ];
        }

        $productCount = 0;
        $catalogueLead = null;
        foreach ($categories as $c) {
            $productCount += count($c['items']);
        }
        foreach ($sections as $s) {
            if ($s['lead'] !== null && ($catalogueLead === null || $s['lead'] > $catalogueLead)) {
                $catalogueLead = $s['lead'];
            }
        }
        $today = date('d/m/Y');

        return [
            'catalogue'  => ['id' => (int) $doc['catalogue']['id'], 'title' => (string) $doc['catalogue']['title'], 'format' => (string) $doc['catalogue']['format']],
            'version'    => ['lang' => $lang, 'shop' => $shop === null ? null : [
                'id'           => (int) $shop['id'],
                'name'         => (string) $shop['name'],
                'address'      => (string) ($shop['address'] ?? ''),
                'phone'        => (string) ($shop['phone'] ?? ''),
                'hours'        => (string) ($shop['hours'] ?? ''),
                'holidayHours' => (string) ($shop['holidayHours'] ?? ''),
            ]],
            'charter'    => ['logoUrl' => $doc['charter']['logoUrl'] ?? null, 'colors' => $doc['charter']['colors']],
            'qr'         => $qr,
            'categories' => $categories,
            'offers'     => $offerList,
            // Le plus long délai du catalogue (heures) : celui sous lequel le délai de la boutique ne descend pas.
            'counts'     => ['products' => $productCount, 'offers' => count($offerList), 'catalogueLeadHours' => $catalogueLead],
            'pages'      => $allPages,
            'conditions' => self::conditionsBlock($shop, $conditions, $nl),
            'labels'     => self::labels($nl, $shop, $conditions, $today, $doc, $allPages),
            'warnings'   => $doc['warnings'] ?? [],
        ];
    }

    /** @param array<string,mixed> $item @return array<string,mixed> */
    private static function productLine(array $item, bool $nl): array
    {
        $grams = $item['weightGrams'] ?? null;
        $format = null;
        if (is_int($grams) && $grams > 0) {
            $format = $grams >= 1000 && $grams % 100 === 0 ? str_replace('.', ',', rtrim(rtrim(number_format($grams / 1000, 1, '.', ''), '0'), '.')) . ' kg' : $grams . ' g';
        }
        $promo = $item['promo'] ?? null;

        return [
            'id'            => (int) $item['id'],
            'name'          => (string) $item['name'],
            'format'        => $format,
            'priceCents'    => $item['priceCents'] ?? null,
            'oldPriceCents' => $item['oldPriceCents'] ?? null,
            'promo'         => is_array($promo) ? ['label' => (string) $promo['label'], 'period' => $promo['period'] ?? null] : null,
            'currency'      => 'EUR',
        ];
    }

    /** @param array<string,mixed> $item @return array<string,mixed> */
    private static function offerLine(array $item, bool $nl): array
    {
        $parts = [];
        foreach ($item['products'] ?? [] as $p) {
            $q = $p['quantity'] ?? null;
            $parts[] = (is_numeric($q) && (float) $q > 1 ? rtrim(rtrim(number_format((float) $q, 2, ',', ''), '0'), ',') . ' × ' : '') . $p['name'];
        }
        $more = (int) ($item['moreProducts'] ?? 0);
        $contents = implode(', ', $parts) . ($more > 0 ? ($nl ? sprintf(' en nog %d', $more) : sprintf(' et %d autre%s', $more, $more > 1 ? 's' : '')) : '');
        $deal = $item['deal'] ?? null;

        return [
            'id'            => (string) $item['id'],
            'type'          => (string) ($item['type'] ?? ''),
            'name'          => (string) $item['name'],
            'badge'         => (string) ($item['badge'] ?? ''),
            'deal'          => $deal,
            'contents'      => $contents,
            'period'        => $item['period'] ?? null,
            'priceCents'    => $item['priceCents'] ?? null,
            'oldPriceCents' => $item['oldPriceCents'] ?? null,
            'currency'      => 'EUR',
            'pages'         => [],
        ];
    }

    /** « 48 h », « 3 jours » ; NL « 48 u », « 3 dagen ». */
    private static function delayText(int $hours, ?array $own, bool $nl): string
    {
        if ($own !== null && $own['unit'] === 'days' && $own['value'] * 24 === $hours) {
            return $own['value'] . ' ' . ($nl ? ($own['value'] > 1 ? 'dagen' : 'dag') : ($own['value'] > 1 ? 'jours' : 'jour'));
        }

        return $hours . ($nl ? ' u' : ' h');
    }

    /**
     * Le délai d'une catégorie : le plus long de celui du catalogue (le délai de préparation de ses produits) et de celui
     * de la boutique. @return array{hours:int, text:string, source:string}|null
     */
    private static function delay(?int $catalogue, ?int $shop, ?array $own, bool $nl): ?array
    {
        if ($catalogue === null && $shop === null) {
            return null;
        }
        $fromShop = $shop !== null && ($catalogue === null || $shop > $catalogue);
        $hours = $fromShop ? $shop : (int) $catalogue;

        return ['hours' => $hours, 'text' => ($nl ? 'op bestelling ' : 'sur commande ') . self::delayText($hours, $fromShop ? $own : null, $nl), 'source' => $fromShop ? 'boutique' : 'catalogue'];
    }

    /**
     * Le pied d'une catégorie : la disponibilité que le catalogue imprime en pied de ses pages, et le délai le plus long
     * — celui de la boutique remplace « sur commande N h » du catalogue quand il est plus long.
     *
     * @param list<string> $footers
     */
    private static function footer(array $footers, ?int $catalogue, ?int $shop, ?array $own, bool $nl): ?string
    {
        $delay = self::delay($catalogue, $shop, $own, $nl);
        $text = implode(' · ', $footers);
        if ($delay !== null && $delay['source'] === 'boutique') {
            // Le délai de la boutique prend la place de celui du catalogue, là où le pied le disait.
            $text = (string) preg_replace('/(sur commande|op bestelling) \d+ (h|u)\b/u', $delay['text'], $text, 1);
        }
        $has = (bool) preg_match('/(sur commande|op bestelling) \d+ (h|u)\b/u', $text);
        if ($delay !== null && !$has) {
            $text = $text === '' ? $delay['text'] : $text . ' · ' . $delay['text'];
        }
        $text = trim($text);
        if ($delay !== null && in_array(mb_strtolower(str_replace(' · ' . $delay['text'], '', $text)), ['disponible', 'beschikbaar'], true)) {
            $text = str_replace(' · ', ' ', $text);
        }

        return $text === '' ? null : mb_strtoupper(mb_substr($text, 0, 1)) . mb_substr($text, 1);
    }

    private static function dm(string $date): string
    {
        return (int) substr($date, 8, 2) . '/' . (int) substr($date, 5, 2);
    }

    private static function money(int $cents, bool $nl): string
    {
        $amount = number_format($cents / 100, 2, ',', $nl ? '.' : ' ');

        return $nl ? '€ ' . $amount : $amount . ' €';
    }

    /**
     * Le cadre « Conditions de la boutique » : ses lignes telles qu'elles s'impriment, ou `empty` (version générale,
     * boutique sans conditions) — le cadre s'imprime alors avec des lignes à remplir.
     *
     * @param array<string,mixed>|null $shop
     * @param array<string,mixed>|null $c
     * @return array<string,mixed>
     */
    private static function conditionsBlock(?array $shop, ?array $c, bool $nl): array
    {
        $title = $nl ? 'Voorwaarden van de winkel' : 'Conditions de la boutique';
        if ($c === null) {
            return ['configured' => false, 'title' => $title, 'by' => null, 'lines' => [], 'depositPct' => null, 'pickup' => true, 'delivery' => true, 'updatedAt' => null];
        }
        $lines = [];
        $deadlines = array_map(static fn (array $d): string => $nl
            ? sprintf('voor %s: tot %s', self::dm($d['for']), self::dm($d['until']))
            : sprintf('pour le %s : jusqu’au %s', self::dm($d['for']), self::dm($d['until'])), $c['holidayDeadlines']);
        if ($c['minDelay'] !== null) {
            $hours = $c['minDelay']['value'] * ($c['minDelay']['unit'] === 'days' ? 24 : 1);
            $when = self::delayText($hours, $c['minDelay'], $nl);
            $line = $nl ? sprintf('Bestellen ten laatste %s vóór het afhalen', $when) : sprintf('Commande au plus tard %s avant le retrait', $when);
            $lines[] = $line . ($deadlines !== [] ? ($nl ? '; ' : ' ; ') . implode(' · ', $deadlines) : '') . '.';
        } elseif ($deadlines !== []) {
            $lines[] = ($nl ? 'Laatste besteldag: ' : 'Dernier jour de commande : ') . implode(' · ', $deadlines) . '.';
        }
        if (($c['depositPct'] ?? 0) > 0) {
            $lines[] = $nl ? sprintf('Voorschot van %d %% bij de bestelling, saldo bij het afhalen.', $c['depositPct']) : sprintf('Acompte de %d %% à la commande, solde au retrait.', $c['depositPct']);
        } elseif ($c['depositPct'] === 0) {
            $lines[] = $nl ? 'Geen voorschot: betaling bij het afhalen.' : 'Pas d’acompte : paiement au retrait.';
        }
        $d = $c['delivery'];
        $deliveryText = null;
        if ($d['enabled']) {
            $deliveryText = $nl ? 'levering mogelijk' : 'livraison possible';
            if ($d['radiusKm'] !== null) {
                $deliveryText .= $nl ? sprintf(' binnen een straal van %d km', $d['radiusKm']) : sprintf(' dans un rayon de %d km', $d['radiusKm']);
            }
            if ($d['feeCents'] !== null) {
                $deliveryText .= $d['feeCents'] === 0 ? ($nl ? ', gratis' : ', gratuite') : ($nl ? ': ' : ' : ') . self::money($d['feeCents'], $nl);
            }
        }
        if ($c['pickup'] && $deliveryText !== null) {
            $lines[] = ($nl ? 'Afhalen in de winkel · ' : 'Retrait en boutique · ') . $deliveryText . '.';
        } elseif ($c['pickup']) {
            $lines[] = $nl ? 'Afhalen in de winkel (geen levering).' : 'Retrait en boutique (pas de livraison).';
        } elseif ($deliveryText !== null) {
            $lines[] = mb_strtoupper(mb_substr($deliveryText, 0, 1)) . mb_substr($deliveryText, 1) . ($nl ? ' (niet af te halen).' : ' (pas de retrait).');
        }
        $note = $nl ? ($c['note']['nl'] !== '' ? $c['note']['nl'] : $c['note']['fr']) : $c['note']['fr'];
        if ($note !== '') {
            $lines[] = $note;
        }
        $name = $shop['name'] ?? '';

        return [
            'configured' => true,
            'title'      => $title,
            'by'         => $nl ? 'Ingesteld door L’Atelier By ' . $name : 'Réglées par L’Atelier By ' . $name,
            'lines'      => $lines,
            'depositPct' => $c['depositPct'],
            'pickup'     => $c['pickup'],
            'delivery'   => $d['enabled'],
            'updatedAt'  => $c['updatedAt'] ?? null,
        ];
    }

    /**
     * Les libellés fixes du bon, dans sa langue (relus, jamais d'IA) — l'écran ne traduit rien.
     *
     * @param list<int> $pages
     * @return array<string,string>
     */
    private static function labels(bool $nl, ?array $shop, ?array $c, string $today, array $doc, array $pages): array
    {
        $deposit = $c['depositPct'] ?? null;
        $range = $pages === [] ? '' : (count($pages) === 1 ? ($nl ? 'pagina ' : 'page ') . $pages[0] : ($nl ? 'pagina’s ' : 'pages ') . $pages[0] . ($nl ? ' tot ' : ' à ') . $pages[count($pages) - 1]);
        $version = $shop !== null ? ($nl ? 'versie ' : 'version ') . $shop['name'] : ($nl ? 'algemene versie' : 'version générale');

        return [
            'title'       => $nl ? 'Bestelbon' : 'Bon de commande',
            'subtitle'    => ($nl ? 'Catalogus ' : 'Catalogue ') . $doc['catalogue']['title'] . ($shop !== null ? ' · ' . $shop['name'] : ''),
            'name'        => $nl ? 'Naam en voornaam' : 'Nom et prénom',
            'phone'       => $nl ? 'Telefoon' : 'Téléphone',
            'email'       => $nl ? 'E-mail' : 'E-mail',
            'pickup'      => $nl ? 'Afhalen' : 'Retrait',
            'delivery'    => $nl ? 'Levering' : 'Livraison',
            'date'        => $nl ? 'Datum' : 'Date',
            'time'        => $nl ? 'Uur' : 'Heure',
            'address'     => $nl ? 'Leveradres' : 'Adresse livraison',
            'remark'      => $nl ? 'Opmerking (boodschap op de taart, allergie…)' : 'Remarque (message sur le gâteau, allergie…)',
            'product'     => $nl ? 'Product' : 'Produit',
            'format'      => $nl ? 'Formaat' : 'Format',
            'price'       => $nl ? 'Prijs' : 'Prix',
            'qty'         => $nl ? 'Aantal' : 'Qté',
            'total'       => $nl ? 'Totaal' : 'Total',
            'pagesWord'   => $nl ? 'blz.' : 'pages',
            'offers'      => $nl ? 'Onze aanbiedingen' : 'Nos offres',
            'other'       => $nl ? 'Andere vraag:' : 'Autre demande :',
            'continued'   => $nl ? '(vervolg)' : '(suite)',
            'deposit'     => $nl ? ($deposit !== null && $deposit > 0 ? sprintf('Betaald voorschot (%d %%)', $deposit) : 'Betaald voorschot') : ($deposit !== null && $deposit > 0 ? sprintf('Acompte versé (%d %%)', $deposit) : 'Acompte versé'),
            'rest'        => $nl ? 'Te betalen bij het afhalen' : 'Reste à payer au retrait',
            'emptyHint'   => $nl ? 'In te vullen door de winkel: besteltermijn, voorschot, afhalen of levering.' : 'À remplir par la boutique : délai de commande, acompte, retrait ou livraison.',
            'prices'      => ($nl ? 'Prijzen incl. btw van de webshop' : 'Prix TVAC du webshop') . ($shop !== null ? ($nl ? ' van de winkel' : ' de la boutique') : '') . ($nl ? ' op ' : ' au ') . $today . ($nl ? ' · aanbiedingen geldig op de vermelde data.' : ' · offres valables aux dates indiquées.'),
            'reserved'    => $nl ? 'Voorbehouden aan de winkel' : 'Réservé à la boutique',
            'number'      => $nl ? 'Nr.' : 'N°',
            'receivedBy'  => $nl ? 'Ontvangen door' : 'Reçu par',
            'on'          => $nl ? 'op' : 'le',
            'ready'       => $nl ? 'Klaar' : 'Prêt',
            'collected'   => $nl ? 'Afgehaald' : 'Retiré',
            'footer'      => ($nl ? 'Inhoud van de catalogus « ' : 'Contenu du catalogue « ') . $doc['catalogue']['title'] . ' » · ' . $version . ($range !== '' ? ' · ' . $range : '') . ' · ' . strtoupper($nl ? 'nl' : 'fr'),
            'brand'       => 'L’Atelier By',
            'sheet'       => $nl ? 'Blad' : 'Feuille',
        ];
    }
}
