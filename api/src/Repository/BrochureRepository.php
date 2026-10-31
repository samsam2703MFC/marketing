<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use RuntimeException;

/**
 * Les réglages des brochures d'une campagne (leaflet A5, dépliant A4 3 volets).
 *
 * Le contenu imprimé vient du dossier d'impression (`PrintRepository`) ; ce
 * dépôt ne garde que ce qui appartient à la brochure : modèle, textes FR/NL,
 * choix et ordre des produits, prix saisis à la main, destination du QR code,
 * boutiques écartées. Le périmètre est celui de la campagne : qui ne la voit
 * pas ne voit pas ses brochures, et seule une campagne qu'on peut modifier
 * reçoit des réglages.
 *
 * La validation est stricte : une clé inconnue, un modèle hors liste ou un
 * texte trop long refusent l'envoi entier, en les nommant. Rien n'est rattrapé
 * en silence.
 */
final class BrochureRepository
{
    public const FORMATS   = ['leaflet-a5', 'depliant-a4'];
    public const TEMPLATES = ['fetes', 'epure', 'ruby', 'abricot', 'noir', 'duo', 'carte'];
    public const TEXTS     = ['eyebrow', 'title', 'phrase', 'cta', 'ctaSub', 'innerTitle', 'innerSub', 'flapTitle', 'flapText', 'conditions'];
    public const LANGS     = ['fr', 'nl'];

    private const TEXT_MAX     = 240;
    private const PRODUCTS_MAX = 80;

    public function __construct(
        private readonly CampaignRepository $campaigns = new CampaignRepository(),
    ) {
    }

    /**
     * Les réglages enregistrés d'une campagne, un par format.
     *
     * @return list<array<string,mixed>>|null `null` : campagne inconnue ou hors périmètre.
     */
    public function forCampaign(AuthContext $auth, int $campaignId): ?array
    {
        if ($this->campaigns->find($auth, $campaignId) === null) {
            return null;
        }

        $statement = Database::connection()->prepare(
            'SELECT format, settings, updated_at FROM mar_campaign_brochure WHERE campaign_id = :id ORDER BY format'
        );
        $statement->execute(['id' => $campaignId]);

        return array_map(static fn (array $row): array => [
            'format'     => (string) $row['format'],
            'settings'   => json_decode((string) $row['settings'], true) ?: (object) [],
            'updated_at' => $row['updated_at'],
        ], $statement->fetchAll());
    }

    /**
     * Enregistre les réglages d'un format : ils remplacent les précédents. Rejouer le même envoi
     * donne le même état.
     *
     * @param  mixed $settings
     * @return bool `false` : campagne inconnue ou hors périmètre.
     */
    public function save(AuthContext $auth, int $campaignId, string $format, mixed $settings): bool
    {
        $campaign = $this->campaigns->find($auth, $campaignId);
        if ($campaign === null) {
            return false;
        }

        // Même règle que la campagne elle-même : le réseau règle toute campagne, une boutique ses
        // campagnes locales.
        if (!$auth->isBrandAdmin() && ($campaign['scope'] ?? null) !== 'LOCALE') {
            throw new RuntimeException('Une campagne réseau ne se modifie qu\'au niveau du réseau.');
        }

        if (!in_array($format, self::FORMATS, true)) {
            throw new RuntimeException('Format inconnu : « ' . $format . ' » (attendu : ' . implode(', ', self::FORMATS) . ').');
        }

        $clean = self::validated($settings);

        Database::connection()->prepare(
            'INSERT INTO mar_campaign_brochure (campaign_id, format, settings, updated_by)
             VALUES (:campaign_id, :format, :settings, :updated_by)
             ON DUPLICATE KEY UPDATE settings = :nouveaux, updated_by = :auteur'
        )->execute([
            'campaign_id' => $campaignId,
            'format'      => $format,
            'settings'    => $clean,
            'updated_by'  => $auth->userId,
            'nouveaux'    => $clean,
            'auteur'      => $auth->userId,
        ]);

        return true;
    }

    /**
     * Les réglages contrôlés, rendus en JSON. Toute clé inconnue est refusée.
     *
     * @param mixed $settings
     */
    public static function validated(mixed $settings): string
    {
        if (!is_array($settings) || array_is_list($settings) && $settings !== []) {
            throw new RuntimeException('settings attendu : un objet.');
        }
        self::onlyKeys($settings, ['template', 'texts', 'products', 'qr', 'excludedShops', 'cropMarks'], 'settings');

        $out = [];

        $template = $settings['template'] ?? 'fetes';
        if (!in_array($template, self::TEMPLATES, true)) {
            throw new RuntimeException('Modèle inconnu : « ' . (is_scalar($template) ? (string) $template : '?') . ' ».');
        }
        $out['template'] = $template;

        $out['texts'] = [];
        $texts = $settings['texts'] ?? [];
        if (!is_array($texts)) {
            throw new RuntimeException('texts attendu : { fr: {…}, nl: {…} }.');
        }
        self::onlyKeys($texts, self::LANGS, 'texts');
        foreach ($texts as $lang => $values) {
            if (!is_array($values)) {
                throw new RuntimeException('texts.' . $lang . ' attendu : un objet.');
            }
            self::onlyKeys($values, self::TEXTS, 'texts.' . $lang);
            foreach ($values as $key => $value) {
                if (!is_string($value)) {
                    throw new RuntimeException('texts.' . $lang . '.' . $key . ' attendu : un texte.');
                }
                if (mb_strlen($value) > self::TEXT_MAX) {
                    throw new RuntimeException('texts.' . $lang . '.' . $key . ' : ' . self::TEXT_MAX . ' caractères au plus.');
                }
                $out['texts'][$lang][$key] = $value;
            }
        }
        $out['texts'] = (object) $out['texts'];

        $products = $settings['products'] ?? [];
        if (!is_array($products) || !array_is_list($products) || count($products) > self::PRODUCTS_MAX) {
            throw new RuntimeException('products attendu : une liste de ' . self::PRODUCTS_MAX . ' produits au plus.');
        }
        $out['products'] = [];
        foreach ($products as $i => $product) {
            if (!is_array($product)) {
                throw new RuntimeException('products[' . $i . '] attendu : { key, on, price }.');
            }
            self::onlyKeys($product, ['key', 'on', 'price'], 'products[' . $i . ']');
            $key = $product['key'] ?? null;
            if (!is_string($key) || $key === '' || mb_strlen($key) > 120) {
                throw new RuntimeException('products[' . $i . '].key attendu : un texte de 120 caractères au plus.');
            }
            $price = $product['price'] ?? null;
            if ($price !== null && (!is_int($price) && !is_float($price) || $price < 0 || $price > 9999.99)) {
                throw new RuntimeException('products[' . $i . '].price : un montant entre 0 et 9 999,99 €, ou null.');
            }
            $out['products'][] = ['key' => $key, 'on' => (bool) ($product['on'] ?? true), 'price' => $price === null ? null : round((float) $price, 2)];
        }

        $qr = $settings['qr'] ?? ['mode' => 'webshop'];
        if (!is_array($qr)) {
            throw new RuntimeException('qr attendu : { mode, category, group }.');
        }
        self::onlyKeys($qr, ['mode', 'category', 'group'], 'qr');
        $mode = $qr['mode'] ?? 'webshop';
        if (!in_array($mode, ['webshop', 'category'], true)) {
            throw new RuntimeException('qr.mode attendu : webshop ou category.');
        }
        foreach (['category', 'group'] as $key) {
            if (isset($qr[$key]) && (!is_int($qr[$key]) || $qr[$key] <= 0)) {
                throw new RuntimeException('qr.' . $key . ' attendu : un identifiant du webshop.');
            }
        }
        if ($mode === 'category' && !isset($qr['category'])) {
            throw new RuntimeException('qr.category est requis quand le QR code mène à une catégorie.');
        }
        $out['qr'] = ['mode' => $mode, 'category' => $qr['category'] ?? null, 'group' => $qr['group'] ?? null];

        $excluded = $settings['excludedShops'] ?? [];
        if (!is_array($excluded) || !array_is_list($excluded) || count($excluded) > 500) {
            throw new RuntimeException('excludedShops attendu : une liste d\'identifiants de boutique.');
        }
        foreach ($excluded as $id) {
            if (!is_int($id) || $id <= 0) {
                throw new RuntimeException('excludedShops attendu : des identifiants de boutique.');
            }
        }
        $out['excludedShops'] = array_values(array_unique($excluded));

        $out['cropMarks'] = (bool) ($settings['cropMarks'] ?? false);

        return (string) json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** @param array<array-key,mixed> $value */
    private static function onlyKeys(array $value, array $allowed, string $where): void
    {
        $unknown = array_diff(array_map('strval', array_keys($value)), $allowed);
        if ($unknown !== []) {
            throw new RuntimeException($where . ' : clé inconnue « ' . implode(' », « ', $unknown) . ' ».');
        }
    }
}
