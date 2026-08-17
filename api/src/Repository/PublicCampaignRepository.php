<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\Database;
use Marketing\Support\OfferPricing;
use RuntimeException;

/**
 * Les campagnes telles que la boutique en ligne les affiche.
 *
 * La colonne `show_web_shop` existait depuis la migration 032 et rien ne la
 * lisait : le module savait qu'une campagne devait paraître en vitrine, mais
 * personne ne pouvait le lui demander.
 *
 * Route publique — la seule du module. Deux conséquences qui gouvernent tout ce
 * dépôt :
 *
 * — **rien d'interne ne sort.** Ni budget, ni marge, ni objectif, ni prospect,
 *   ni identifiant de boutique. La sélection des colonnes est explicite pour
 *   cette raison : un `SELECT *` publierait la prochaine colonne ajoutée sans
 *   que personne ne l'ait décidé.
 * — **la sélection est fermée.** Une campagne paraît si elle le demande
 *   (`show_web_shop`), si elle n'est plus un brouillon, et si la date consultée
 *   tombe dans sa période. Trois conditions, aucune déduite.
 */
final class PublicCampaignRepository
{
    /** Un brouillon n'a rien à faire en vitrine, même s'il coche la case. */
    private const PUBLISHABLE_STATUSES = ['live', 'planned', 'done'];

    /**
     * @param  array{page?:int, perPage?:int, activeOn?:?string} $query
     * @return array{rows:list<array<string,mixed>>, total:int, page:int, perPage:int}
     */
    public function published(array $query = []): array
    {
        $jour = $this->jour($query['activeOn'] ?? null);
        $page    = max(1, (int) ($query['page'] ?? 1));
        // Le maximum ramène au lieu de refuser (§8.1) : une vitrine qui demande
        // trop n'a pas à recevoir une erreur, seulement moins.
        $perPage = min(100, max(1, (int) ($query['perPage'] ?? 25)));

        $connection = Database::connection();

        $conditions = 'c.show_web_shop = 1
                   AND c.status_code IN (' . implode(', ', array_fill(0, count(self::PUBLISHABLE_STATUSES), '?')) . ')
                   AND (c.starts_on IS NULL OR c.starts_on <= ?)
                   AND (c.ends_on IS NULL OR c.ends_on >= ?)';

        $bindings = [...self::PUBLISHABLE_STATUSES, $jour, $jour];

        $compte = $connection->prepare(
            'SELECT COUNT(*) FROM mar_campaign c WHERE ' . $conditions
        );
        $compte->execute($bindings);
        $total = (int) $compte->fetchColumn();

        $statement = $connection->prepare(sprintf(
            'SELECT c.id, c.name, c.starts_on, c.ends_on,
                    c.color_primary_hex, c.color_secondary_hex, c.color_accent_hex, c.color_ink_hex,
                    t.code AS type_code, t.label AS type_label, t.color_hex AS type_color, t.icon_path
               FROM mar_campaign c
               LEFT JOIN mar_campaign_type t ON t.id = c.type_id
              WHERE %s
              ORDER BY c.starts_on, c.id
              LIMIT %d OFFSET %d',
            $conditions,
            $perPage,
            ($page - 1) * $perPage
        ));
        $statement->execute($bindings);

        $rows = $statement->fetchAll();
        $ids  = array_map(static fn (array $row): int => (int) $row['id'], $rows);

        $offres    = $this->offers($ids);
        $visuels   = $this->visuals($ids);
        $boutiques = $this->shops($ids);

        $campagnes = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];

            $campagnes[] = [
                // Identifiants en chaîne (§3.1) : rien côté vitrine ne fait
                // d'arithmétique dessus, et le jour où l'ERP passe aux UUID le
                // contrat ne bouge pas.
                'id'       => (string) $id,
                'name'     => $row['name'],
                'startsOn' => $row['starts_on'],
                'endsOn'   => $row['ends_on'],
                'type'     => $row['type_code'] === null ? null : [
                    'code'     => $row['type_code'],
                    'label'    => $row['type_label'],
                    'colorHex' => $row['type_color'],
                    'iconPath' => $row['icon_path'],
                ],
                'colors' => [
                    'primaryHex'   => $row['color_primary_hex'] ?? CampaignRepository::COLORS['color_primary_hex'],
                    'secondaryHex' => $row['color_secondary_hex'] ?? CampaignRepository::COLORS['color_secondary_hex'],
                    'accentHex'    => $row['color_accent_hex'] ?? CampaignRepository::COLORS['color_accent_hex'],
                    'inkHex'       => $row['color_ink_hex'] ?? CampaignRepository::COLORS['color_ink_hex'],
                ],
                'image'  => $visuels[$id] ?? null,
                'offer'  => $offres[$id] ?? null,
                // Les boutiques par leur nom et leur ville : une vitrine dit où
                // l'offre s'applique, elle n'a pas besoin de nos identifiants.
                'shops'  => $boutiques[$id] ?? [],
            ];
        }

        return ['rows' => $campagnes, 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    /**
     * L'offre d'une campagne : son titre, sa phrase, ses produits et leurs prix.
     *
     * @param  list<int> $ids
     * @return array<int, array<string,mixed>>
     */
    private function offers(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $marques = implode(', ', array_fill(0, count($ids), '?'));

        $offres = Database::connection()->prepare(
            "SELECT id, campaign_id, title, mechanic_text
               FROM mar_campaign_offer WHERE campaign_id IN ($marques)"
        );
        $offres->execute($ids);

        $parCampagne = [];
        $parOffre    = [];
        foreach ($offres->fetchAll() as $offre) {
            $parOffre[(int) $offre['id']] = (int) $offre['campaign_id'];
            $parCampagne[(int) $offre['campaign_id']] = [
                'title'        => $offre['title'],
                'mechanicText' => $offre['mechanic_text'],
                'items'        => [],
            ];
        }

        if ($parOffre === []) {
            return [];
        }

        $offreIds = implode(', ', array_fill(0, count($parOffre), '?'));
        $items = Database::connection()->prepare(
            "SELECT ci.campaign_offer_id, ci.label, ci.mechanic_type, ci.discount_pct,
                    ci.fixed_price, ci.buy_qty, ci.get_qty, ci.baseline_price,
                    i.name AS catalog_name, i.image_url
               FROM mar_campaign_offer_item ci
               LEFT JOIN mar_offer_item i ON i.id = ci.offer_item_id
              WHERE ci.campaign_offer_id IN ($offreIds)
              ORDER BY ci.id"
        );
        $items->execute(array_keys($parOffre));

        foreach ($items->fetchAll() as $item) {
            $campagne = $parOffre[(int) $item['campaign_offer_id']] ?? null;
            if ($campagne === null) {
                continue;
            }

            $depart = $item['baseline_price'] === null ? null : (float) $item['baseline_price'];
            $calcul = OfferPricing::apply($item, $depart);

            $parCampagne[$campagne]['items'][] = [
                'name'  => $item['catalog_name'] ?? $item['label'],
                'imageUrl' => $item['image_url'],
                // Montants en unité mineure et devise à part (§3.1) : un prix
                // en flottant finit par afficher 4,199999999 sur un site.
                'priceBeforeCents' => $this->cents($calcul['before']),
                'priceAfterCents'  => $this->cents($calcul['after']),
                'currency'         => 'EUR',
                'mechanicText'     => $calcul['mechanic']['text'] ?? null,
            ];
        }

        return $parCampagne;
    }

    /**
     * @param  list<int> $ids
     * @return array<int, array<string,mixed>>
     */
    private function visuals(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $marques = implode(', ', array_fill(0, count($ids), '?'));
        $assets  = Database::connection()->prepare(
            "SELECT campaign_id, file_url, focal_point_y, fit
               FROM mar_campaign_asset WHERE campaign_id IN ($marques) ORDER BY id"
        );
        $assets->execute($ids);

        $parCampagne = [];
        foreach ($assets->fetchAll() as $asset) {
            $parCampagne[(int) $asset['campaign_id']] ??= [
                'url'         => $asset['file_url'],
                'focalPointY' => (float) $asset['focal_point_y'],
                'fit'         => $asset['fit'],
            ];
        }

        return $parCampagne;
    }

    /**
     * @param  list<int> $ids
     * @return array<int, list<array<string,string|null>>>
     */
    private function shops(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $marques = implode(', ', array_fill(0, count($ids), '?'));
        $liens   = Database::connection()->prepare(
            "SELECT cs.campaign_id, s.name, s.city
               FROM mar_campaign_shop cs
               JOIN mar_shop s ON s.id = cs.shop_id
              WHERE cs.campaign_id IN ($marques)
              ORDER BY s.name"
        );
        $liens->execute($ids);

        $parCampagne = [];
        foreach ($liens->fetchAll() as $lien) {
            $parCampagne[(int) $lien['campaign_id']][] = [
                'name' => $lien['name'],
                'city' => $lien['city'],
            ];
        }

        return $parCampagne;
    }

    /** Le jour consulté : aujourd'hui, ou celui demandé pour prévisualiser. */
    private function jour(?string $demande): string
    {
        if ($demande === null || trim($demande) === '') {
            return date('Y-m-d');
        }

        $lu = \DateTimeImmutable::createFromFormat('!Y-m-d', trim($demande));
        if ($lu === false || $lu->format('Y-m-d') !== trim($demande)) {
            throw new RuntimeException('Date invalide : format attendu AAAA-MM-JJ.');
        }

        return $lu->format('Y-m-d');
    }

    private function cents(?float $montant): ?int
    {
        return $montant === null ? null : (int) round($montant * 100);
    }
}
