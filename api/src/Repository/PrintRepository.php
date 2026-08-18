<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;
use RuntimeException;

/**
 * Tout ce qu'un support imprimé doit savoir, en un seul appel.
 *
 * Un gabarit avait besoin de trois lectures — la campagne, son brouillon, les
 * tarifs — et devait recoller lui-même le prix après promotion, que rien ne
 * stocke. Deux gabarits recollaient donc deux fois la même règle, et rien ne
 * garantissait qu'ils tombent sur le même prix.
 *
 * Deux sorties, parce qu'un support se décline en deux jeux :
 *
 *   • **le fichier général** — campagne, visuel, offre, produits, prix réseau ;
 *   • **le fichier d'une franchise** — le général, plus l'identité de la
 *     boutique et sa page objectif.
 *
 * La page objectif ne figure que dans le second : elle s'adresse à l'équipe,
 * pas au client, et le fichier général n'a personne à qui l'adresser.
 *
 * Ce que cette classe ne fait pas : composer. Elle ne connaît ni format ni mise
 * en page ; elle rend des valeurs, y compris celles qu'elle n'a pas — une photo
 * produit absente vaut `null` et non une image de remplacement, faute de quoi
 * un gabarit croirait avoir une photo.
 */
final class PrintRepository
{
    /** TVA alimentaire. Les prix sont affichés TTC, les marges se calculent en HT. */
    private const TVA_PCT = 6.0;

    /**
     * Géométrie d'impression, alignée sur `ImageStore`.
     *
     * Recopiée ici plutôt que lue là-bas : `ImageStore` la garde privée parce
     * qu'elle décrit ce qu'il fait aux fichiers, pas ce qu'un gabarit doit
     * dessiner. Le jour où l'une bouge, le test qui les compare le dit.
     */
    private const PRINT_GEOMETRY = [
        'width_px'  => 1252,
        'height_px' => 1843,
        'width_mm'  => 106,
        'height_mm' => 156,
        'bleed_mm'  => 3,
        'dpi'       => 300,
    ];

    public function __construct(
        private readonly PriceListRepository $prices = new PriceListRepository(),
        private readonly SalesRepository $sales = new SalesRepository(),
    ) {
    }

    /**
     * Le dossier d'impression d'une campagne.
     *
     * @param  int|string|null $shop `null` = le fichier général ; un identifiant
     *                               = celui d'une boutique ; `all` = les deux
     *                               formes, pour générer la série d'un coup.
     * @param  array{from?: string, to?: string} $window Période de référence des
     *                               volumes vendus. Par défaut, les douze
     *                               derniers mois : la période d'analyse de
     *                               l'assistant est une aide de saisie, elle ne
     *                               se conserve pas d'une session à l'autre.
     * @return array<string,mixed>
     */
    public function forCampaign(
        AuthContext $auth,
        int $campaignId,
        int|string|null $shop = null,
        array $window = [],
    ): array {
        $campaign = $this->campaign($auth, $campaignId);

        $to   = $window['to']   ?? date('Y-m-d');
        $from = $window['from'] ?? date('Y-m-d', strtotime($to . ' -1 year'));

        $offer    = $this->offer($campaignId);
        $itemIds  = array_values(array_filter(array_column($offer['items'], 'offer_item_id')));
        $tarifs   = $this->prices->forItems($auth, $itemIds);
        $general  = $this->file($campaign, $offer, $tarifs);

        if ($shop === null) {
            return $general;
        }

        $shops = $this->shops($auth, $campaignId, $campaign);

        if ($shop !== 'all') {
            $only = array_values(array_filter(
                $shops,
                static fn (array $row): bool => $row['id'] === (int) $shop
            ));

            if ($only === []) {
                throw new RuntimeException(
                    'Cette boutique ne participe pas à la campagne, ou sort de votre périmètre.'
                );
            }

            return $general + $this->shopPart($campaignId, $only[0], $itemIds, $from, $to);
        }

        return [
            'general' => $general,
            'by_shop' => array_map(
                fn (array $row): array => $general + $this->shopPart($campaignId, $row, $itemIds, $from, $to),
                $shops
            ),
        ];
    }

    /**
     * Le fichier général : ce qu'un client lit, sans rien qui s'adresse à une
     * équipe.
     *
     * @param  array<string,mixed> $campaign
     * @param  array<string,mixed> $offer
     * @param  array<string,mixed> $tarifs
     * @return array<string,mixed>
     */
    private function file(array $campaign, array $offer, array $tarifs): array
    {
        $colors = array_combine(
            array_map(
                static fn (string $champ): string => str_replace(['color_', '_hex'], '', $champ),
                array_keys(CampaignRepository::COLORS)
            ),
            array_map(
                static fn (string $champ): string => (string) ($campaign[$champ] ?? CampaignRepository::COLORS[$champ]),
                array_keys(CampaignRepository::COLORS)
            )
        );

        $prixParItem = [];
        foreach ($tarifs['items'] as $ligne) {
            $prixParItem[(int) $ligne['item_id']] = $ligne;
        }

        return [
            'campaign' => [
                'id'          => (int) $campaign['id'],
                'name'        => (string) $campaign['name'],
                'starts_on'   => $campaign['starts_on'],
                'ends_on'     => $campaign['ends_on'],
                'type_label'  => $campaign['type_label'],
                'lever_label' => $campaign['lever_label'],
                'tone'        => $campaign['tone'],
                'scope'       => (string) $campaign['scope'],
                'colors'      => $colors,
            ],
            'brand' => [
                'name'     => $campaign['brand_name'],
                'logo_url' => $campaign['logo_url'],
            ],
            'visual' => $campaign['asset_url'] === null ? null : [
                'file_url'      => $campaign['asset_url'],
                'fit'           => $campaign['asset_fit'],
                'focal_point_y' => $campaign['asset_focal'] === null
                    ? null
                    : (float) $campaign['asset_focal'],
            ],
            'offer' => $offer['offer'],
            'products' => array_map(
                fn (array $item): array => $this->product($item, $prixParItem),
                $offer['items']
            ),
            'print' => self::PRINT_GEOMETRY,
            'legal' => $this->legal($campaign, $offer['offer']),
            // D'où viennent les prix — tarif de la boutique lu sur l'ERP, ou
            // catalogue réseau. Un gabarit n'en fait rien, mais quiconque
            // compare deux tirages veut pouvoir répondre à la question.
            'price_source' => $tarifs['erp']['shops_read'] > 0 ? 'boutiques' : 'catalogue',
        ];
    }

    /**
     * Un produit tel qu'il s'imprime : deux prix et une phrase.
     *
     * Le prix après promotion n'est stocké nulle part — il se calcule, et c'est
     * ici qu'il se calcule, une fois. Le laisser au gabarit reviendrait à écrire
     * la règle autant de fois qu'il y a de gabarits.
     *
     * @param  array<string,mixed> $item
     * @param  array<int, array<string,mixed>> $prixParItem
     * @return array<string,mixed>
     */
    private function product(array $item, array $prixParItem): array
    {
        $itemId  = $item['offer_item_id'] === null ? 0 : (int) $item['offer_item_id'];
        $tarif   = $prixParItem[$itemId] ?? null;
        $saisi   = $item['baseline_price'] === null ? null : (float) $item['baseline_price'];
        $avant   = $saisi ?? ($tarif['price'] ?? null);

        // La règle de prix vit dans `OfferPricing` : la vitrine publique
        // l'applique aussi, et une règle écrite deux fois n'est corrigée
        // qu'une fois le jour où une mécanique change.
        $calcul = \Marketing\Support\OfferPricing::apply($item, $avant);
        $apres  = $calcul['after'];
        $texte  = $calcul['mechanic']['text'] ?? null;

        return [
            'label'     => (string) $item['label'],
            'name'      => $item['catalog_name'],
            'family'    => $item['category_detail'],
            'sku_ref'   => $item['sku_ref'],
            // La photo retenue pour cette campagne prime sur celle du
            // catalogue : une opération peut vouloir son propre visuel sans que
            // le catalogue change pour tout le réseau. Aucune des deux ? Un
            // `null` franc, plutôt qu'une image de remplacement qu'un gabarit
            // prendrait pour la photo du produit.
            'image_url' => $item['campaign_image'] ?: $item['catalog_image'],
            'price_before'    => $calcul['before'],
            'price_after'     => $calcul['after'],
            'price_before_ht' => $calcul['before_ht'],
            'price_after_ht'  => $calcul['after_ht'],
            'mechanic'        => $calcul['mechanic'],
            // Réglages d'affichage par produit. `show_photo` vient de l'étape
            // « Photos » ; les trois autres se déduisent de ce qui existe —
            // on n'annonce pas un prix qu'on n'a pas.
            'options' => [
                'show_photo'        => (bool) ($item['show_photo'] ?? 1)
                    && ($item['campaign_image'] ?: $item['catalog_image']) !== null,
                'show_price_before' => $avant !== null,
                'show_price_after'  => $apres !== null,
                'show_mechanic'     => $texte !== null,
            ],
        ];
    }

    /**
     * La part propre à une boutique : son identité, et sa page objectif.
     *
     * @param  array<string,mixed> $shop
     * @param  list<int> $itemIds
     * @return array<string,mixed>
     */
    private function shopPart(int $campaignId, array $shop, array $itemIds, string $from, string $to): array
    {
        $ventes = $this->sales->quantities(
            AuthContext::current(),
            $itemIds,
            $from,
            $to,
            false
        );

        $vendues = [];
        foreach ($ventes['shops'] as $ligne) {
            if ((int) $ligne['shop_id'] === $shop['id']) {
                $vendues = (array) $ligne['quantities'];
                break;
            }
        }

        $familles = [];
        foreach ($ventes['products'] as $produit) {
            $itemId = (int) $produit['item_id'];
            $nom    = $produit['family'] ?? 'Autres';

            $familles[$nom] ??= ['name' => $nom, 'sold' => 0, 'target' => 0, 'products' => []];
            $vendu  = (int) ($vendues[$itemId] ?? 0);
            $cible  = $shop['targets'][$itemId] ?? null;

            $familles[$nom]['sold']   += $vendu;
            // Un produit sans objectif propre garde son historique dans le
            // total : c'est la règle de l'écran, et l'imprimé doit dire la même
            // chose que lui.
            $familles[$nom]['target'] += $cible ?? $vendu;
            $familles[$nom]['products'][] = [
                'name'   => (string) $produit['name'],
                'sold'   => $vendu,
                'target' => $cible,
            ];
        }

        $totalVendu  = array_sum(array_column($familles, 'sold'));
        $totalCible  = $shop['target_pieces'] ?? array_sum(array_column($familles, 'target'));
        $reseau      = (int) $ventes['network']['total'];

        $seuil = $shop['trigger_pct'];
        $barre = $seuil === null ? null : (int) ceil(($totalCible * $seuil) / 100);

        return [
            'shop' => [
                'id'    => $shop['id'],
                'name'  => (string) $shop['name'],
                'city'  => $shop['city'],
                // Manquants dans `mar_shop`, donc francs plutôt que devinés :
                // un dépliant qui invente une adresse est pire qu'un dépliant
                // qui n'en porte pas.
                'address'       => null,
                'phone'         => null,
                'opening_hours' => null,
            ],
            'objective' => [
                'from' => $from,
                'to'   => $to,
                'total_pieces' => (int) $totalCible,
                'sold_pieces'  => $totalVendu,
                'effort_pct'   => $totalVendu === 0
                    ? null
                    : (int) round((($totalCible - $totalVendu) / $totalVendu) * 100),
                'network_share_pct' => $reseau === 0
                    ? null
                    : (int) round(($totalVendu / $reseau) * 100),
                'challenge' => $shop['challenge_enabled'] !== true ? null : [
                    'trigger_pct'    => $seuil,
                    'bar_pieces'     => $barre,
                    'missing_pieces' => $barre === null ? null : max(0, $barre - $totalVendu),
                    'metric'         => $shop['challenge_metric'],
                    'prizes'         => $shop['prizes'],
                ],
                'by_category' => array_values($familles),
            ],
        ];
    }

    /**
     * Mentions de validité, rédigées une fois.
     *
     * @param  array<string,mixed> $campaign
     * @param  array<string,mixed>|null $offer
     * @return array<string,string|null>
     */
    private function legal(array $campaign, ?array $offer): array
    {
        $debut = $offer['starts_on'] ?? $campaign['starts_on'];
        $fin   = $offer['ends_on']   ?? $campaign['ends_on'];

        $jour = static function (?string $date): ?string {
            if ($date === null) {
                return null;
            }

            $mois = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                     'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
            [$annee, $numero, $jourDuMois] = array_map('intval', explode('-', $date));

            return sprintf('%d %s %d', $jourDuMois, $mois[$numero], $annee);
        };

        $conditions = [];
        if (($offer['is_cumulative'] ?? true) === false) {
            $conditions[] = 'Non cumulable avec d\'autres promotions';
        }
        if (($offer['max_qty_per_ticket'] ?? null) !== null) {
            $conditions[] = sprintf('%d par ticket', (int) $offer['max_qty_per_ticket']);
        }
        if (($offer['hour_from'] ?? null) !== null && ($offer['hour_to'] ?? null) !== null) {
            $conditions[] = sprintf(
                'de %s à %s',
                substr((string) $offer['hour_from'], 0, 5),
                substr((string) $offer['hour_to'], 0, 5)
            );
        }
        if (($offer['scope_label'] ?? null) !== null && $offer['scope_label'] !== '') {
            $conditions[] = (string) $offer['scope_label'];
        }

        return [
            'period_text' => $debut === null || $fin === null
                ? null
                : sprintf('Du %s au %s', $jour($debut), $jour($fin)),
            'conditions_text' => $conditions === [] ? null : implode(' · ', $conditions),
        ];
    }

    /**
     * Campagne, sa marque et son visuel, en une lecture.
     *
     * @return array<string,mixed>
     */
    private function campaign(AuthContext $auth, int $campaignId): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');
        $bindings['id']        = $campaignId;

        $statement = Database::connection()->prepare(sprintf(
            'SELECT c.*, b.name AS brand_name, b.logo_url,
                    t.label AS type_label, l.label AS lever_label,
                    a.file_url AS asset_url, a.fit AS asset_fit, a.focal_point_y AS asset_focal
               FROM mar_campaign c
               LEFT JOIN mar_brand b         ON b.id = c.brand_id
               LEFT JOIN mar_campaign_type t ON t.id = c.type_id
               LEFT JOIN mar_lever l         ON l.id = t.lever_id
               LEFT JOIN mar_campaign_asset a ON a.campaign_id = c.id AND a.is_master = 1
              WHERE c.id = :id AND %s
              LIMIT 1',
            $scopeSql
        ));
        $statement->execute($bindings);

        $row = $statement->fetch();

        if ($row === false) {
            throw new RuntimeException('Campagne introuvable.');
        }

        return $row;
    }

    /**
     * L'offre de la campagne et ses lignes, jointes au catalogue.
     *
     * @return array{offer: array<string,mixed>|null, items: list<array<string,mixed>>}
     */
    private function offer(int $campaignId): array
    {
        $connection = Database::connection();

        $statement = $connection->prepare(
            'SELECT id, title, mechanic_text, starts_on, ends_on, hour_from, hour_to,
                    weekdays_mask, scope_label, max_qty_per_ticket, is_cumulative
               FROM mar_campaign_offer WHERE campaign_id = :id ORDER BY id LIMIT 1'
        );
        $statement->execute(['id' => $campaignId]);
        $offer = $statement->fetch();

        if ($offer === false) {
            return ['offer' => null, 'items' => []];
        }

        $items = $connection->prepare(
            'SELECT ci.label, ci.offer_item_id, ci.mechanic_type, ci.discount_pct,
                    ci.fixed_price, ci.buy_qty, ci.get_qty, ci.baseline_price,
                    ci.show_photo, ci.image_url AS campaign_image,
                    oi.name AS catalog_name, oi.detail AS category_detail,
                    oi.sku_ref, oi.image_url AS catalog_image, oi.category
               FROM mar_campaign_offer_item ci
               LEFT JOIN mar_offer_item oi ON oi.id = ci.offer_item_id
              WHERE ci.campaign_offer_id = :id
              ORDER BY ci.sort_order'
        );
        $items->execute(['id' => (int) $offer['id']]);

        return [
            'offer' => [
                'title'              => $offer['title'],
                'mechanic_text'      => $offer['mechanic_text'],
                'starts_on'          => $offer['starts_on'],
                'ends_on'            => $offer['ends_on'],
                'hour_from'          => $offer['hour_from'],
                'hour_to'            => $offer['hour_to'],
                'weekdays_mask'      => $offer['weekdays_mask'] === null ? null : (int) $offer['weekdays_mask'],
                'scope_label'        => $offer['scope_label'],
                'max_qty_per_ticket' => $offer['max_qty_per_ticket'] === null
                    ? null
                    : (int) $offer['max_qty_per_ticket'],
                'is_cumulative'      => (bool) $offer['is_cumulative'],
            ],
            // Seuls les produits s'impriment : une gamme saisonnière entre dans
            // l'offre au même titre qu'un produit, mais elle n'a ni prix ni
            // photo, et une ligne vide sur un dépliant reste une ligne vide.
            'items' => array_values(array_filter(
                $items->fetchAll(),
                static fn (array $row): bool => ($row['category'] ?? 'produit') === 'produit'
            )),
        ];
    }

    /**
     * Boutiques de la campagne, avec leurs objectifs et leur seuil.
     *
     * @param  array<string,mixed> $campaign
     * @return list<array<string,mixed>>
     */
    private function shops(AuthContext $auth, int $campaignId, array $campaign): array
    {
        $connection = Database::connection();

        [$scopeSql, $bindings] = Scope::shopFilter($auth, 's.id');
        $bindings['id']        = $campaignId;

        $statement = $connection->prepare(sprintf(
            'SELECT s.id, s.name, s.city, cs.target_pieces, cs.challenge_trigger_pct
               FROM mar_campaign_shop cs
               JOIN mar_shop s ON s.id = cs.shop_id
              WHERE cs.campaign_id = :id AND %s
              ORDER BY s.name',
            $scopeSql
        ));
        $statement->execute($bindings);
        $rows = $statement->fetchAll();

        $cibles = $connection->prepare(
            'SELECT shop_id, offer_item_id, target_pieces
               FROM mar_campaign_shop_item_target WHERE campaign_id = :id'
        );
        $cibles->execute(['id' => $campaignId]);

        $parBoutique = [];
        foreach ($cibles->fetchAll() as $ligne) {
            $parBoutique[(int) $ligne['shop_id']][(int) $ligne['offer_item_id']] =
                (int) $ligne['target_pieces'];
        }

        $prix = $connection->prepare(
            'SELECT label FROM mar_campaign_challenge_prize
              WHERE campaign_id = :id ORDER BY rank_position'
        );
        $prix->execute(['id' => $campaignId]);
        $recompenses = array_column($prix->fetchAll(), 'label');

        return array_map(static function (array $row) use ($campaign, $parBoutique, $recompenses): array {
            $shopId = (int) $row['id'];

            return [
                'id'   => $shopId,
                'name' => $row['name'],
                'city' => $row['city'],
                'target_pieces' => $row['target_pieces'] === null ? null : (int) $row['target_pieces'],
                'targets'       => $parBoutique[$shopId] ?? [],
                // Seuil propre à la boutique, sinon celui de la campagne : la
                // même cascade que l'écran du challenge.
                'trigger_pct'   => $row['challenge_trigger_pct'] !== null
                    ? (float) $row['challenge_trigger_pct']
                    : ($campaign['challenge_trigger_pct'] === null
                        ? null
                        : (float) $campaign['challenge_trigger_pct']),
                'challenge_enabled' => (bool) $campaign['challenge_enabled'],
                'challenge_metric'  => $campaign['challenge_metric'],
                'prizes'            => $recompenses,
            ];
        }, $rows);
    }
}
