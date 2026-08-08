<?php

declare(strict_types=1);

namespace Marketing\Repository;

use Marketing\Support\AuthContext;
use Marketing\Support\Database;
use Marketing\Support\Scope;

/**
 * Outils de campagne : promotions, bundles, vouchers.
 *
 * Ces trois catalogues sont de niveau réseau. Le périmètre ne s'applique donc
 * qu'à ce qui est rattaché à une campagne : une promotion liée à une campagne
 * locale ne doit pas apparaître chez un franchisé qui n'y participe pas, alors
 * qu'un bundle du catalogue marque concerne tout le monde.
 */
final class CatalogRepository
{
    /**
     * Mécaniques promotionnelles.
     *
     * @return list<array<string,mixed>>
     */
    public function promotions(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT p.id, p.name, p.mechanic_type, p.value_label, p.scope_label,
                    p.availability_label, p.campaign_id,
                    c.name        AS campaign_name,
                    st.label      AS campaign_status_label,
                    st.text_hex   AS campaign_status_text_hex,
                    st.bg_rgba    AS campaign_status_bg_rgba
               FROM mar_promotion p
               LEFT JOIN mar_campaign c         ON c.id = p.campaign_id
               LEFT JOIN mar_campaign_status st ON st.code = c.status_code
              WHERE p.campaign_id IS NULL OR %s
              ORDER BY p.name',
            $scopeSql
        ));
        $statement->execute($bindings);

        return array_map([$this, 'cast'], $statement->fetchAll());
    }

    /**
     * Menus et bundles, avec leur composition.
     *
     * @return list<array<string,mixed>>
     */
    /**
     * Offres portées par une campagne.
     *
     * `mar_promotion` et `mar_campaign_offer` décrivent deux choses proches
     * mais distinctes : la première est une promotion du catalogue, alimentée
     * par l'import produit ; la seconde est l'offre montée dans l'assistant de
     * campagne. Rien ne les reliait, si bien qu'une offre créée à l'étape 2
     * n'apparaissait sur aucun écran de l'onglet « Promotions » — l'endroit
     * exact où l'on va la chercher.
     *
     * @return list<array<string,mixed>>
     */
    public function campaignOffers(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');

        $statement = Database::connection()->prepare(sprintf(
            'SELECT co.id, co.title, co.mechanic_text, co.starts_on, co.ends_on,
                    co.hour_from, co.hour_to,
                    t.label     AS template_label,
                    c.id        AS campaign_id,
                    c.name      AS campaign_name,
                    st.label    AS campaign_status_label,
                    st.text_hex AS campaign_status_text_hex,
                    st.bg_rgba  AS campaign_status_bg_rgba,
                    COUNT(coi.id) AS items_count
               FROM mar_campaign_offer co
               JOIN mar_campaign c            ON c.id = co.campaign_id
               JOIN mar_campaign_status st    ON st.code = c.status_code
               LEFT JOIN mar_offer_template t ON t.id = co.template_id
               LEFT JOIN mar_campaign_offer_item coi ON coi.campaign_offer_id = co.id
              WHERE %s
              GROUP BY co.id, co.title, co.mechanic_text, co.starts_on, co.ends_on,
                       co.hour_from, co.hour_to, t.label, c.id, c.name,
                       st.label, st.text_hex, st.bg_rgba, c.starts_on
              ORDER BY c.starts_on DESC, co.id DESC',
            $scopeSql
        ));
        $statement->execute($bindings);

        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row['id']          = (int) $row['id'];
            $row['campaign_id'] = (int) $row['campaign_id'];
            $row['items_count'] = (int) $row['items_count'];
        }

        return $rows;
    }

    public function bundles(): array
    {
        $connection = Database::connection();

        $bundles = $connection
            ->query('SELECT id, name, price_amount, margin_pct, image_url FROM mar_bundle ORDER BY name')
            ->fetchAll();

        // Une seule requête pour toutes les compositions plutôt qu'une par
        // bundle : la liste en compte peu, mais la boucle imbriquée est le
        // réflexe qui fait tomber ce genre d'écran dès qu'il grandit.
        $items = $connection->query(
            'SELECT bi.bundle_id, bi.quantity, oi.name, oi.detail, oi.price_amount
               FROM mar_bundle_item bi
               JOIN mar_offer_item oi ON oi.id = bi.offer_item_id
              ORDER BY bi.sort_order, oi.name'
        )->fetchAll();

        $byBundle = [];
        foreach ($items as $item) {
            $byBundle[(int) $item['bundle_id']][] = [
                'name'         => $item['name'],
                'detail'       => $item['detail'],
                'quantity'     => (int) $item['quantity'],
                'price_amount' => $item['price_amount'] !== null ? (float) $item['price_amount'] : null,
            ];
        }

        foreach ($bundles as &$bundle) {
            $bundle          = $this->cast($bundle);
            $bundle['items'] = $byBundle[(int) $bundle['id']] ?? [];
        }

        return $bundles;
    }

    /**
     * Bons et codes, avec leurs canaux et le compte d'utilisations.
     *
     * Le compteur est un COUNT sur les utilisations réelles, jamais une colonne
     * dénormalisée : c'est la même donnée qui sert le ROI, elle ne peut pas
     * diverger.
     *
     * @return list<array<string,mixed>>
     */
    public function vouchers(AuthContext $auth): array
    {
        [$scopeSql, $bindings] = Scope::campaignFilter($auth, 'c');
        [$shopSql, $shopBindings] = Scope::shopFilter($auth, 'r.shop_id');
        $bindings = array_merge($bindings, $shopBindings);

        // Une seule jointure plutôt que deux sous-requêtes : le filtre de
        // périmètre n'apparaît qu'une fois. Les requêtes préparées côté serveur
        // refusent qu'un paramètre nommé soit lié à plusieurs positions, et deux
        // sous-requêtes identiques y tombent immédiatement.
        $statement = Database::connection()->prepare(sprintf(
            'SELECT v.id, v.code, v.mechanic_label, v.scope_label, v.usage_limit_label,
                    v.status, v.source, v.partner_name, v.campaign_id,
                    c.name AS campaign_name,
                    COUNT(r.id)                             AS redemptions,
                    COALESCE(SUM(r.discount_amount), 0)     AS discount_total
               FROM mar_voucher v
               LEFT JOIN mar_campaign c ON c.id = v.campaign_id
               LEFT JOIN mar_voucher_redemption r
                      ON r.voucher_id = v.id AND (r.shop_id IS NULL OR %2$s)
              WHERE v.campaign_id IS NULL OR %1$s
              GROUP BY v.id, v.code, v.mechanic_label, v.scope_label, v.usage_limit_label,
                       v.status, v.source, v.partner_name, v.campaign_id, c.name
              ORDER BY v.code',
            $scopeSql,
            $shopSql
        ));
        $statement->execute($bindings);

        $vouchers = array_map([$this, 'cast'], $statement->fetchAll());

        $channels = Database::connection()
            ->query('SELECT voucher_id, channel_code FROM mar_voucher_channel ORDER BY channel_code')
            ->fetchAll();

        $byVoucher = [];
        foreach ($channels as $channel) {
            $byVoucher[(int) $channel['voucher_id']][] = $channel['channel_code'];
        }

        foreach ($vouchers as &$voucher) {
            $voucher['channels'] = $byVoucher[(int) $voucher['id']] ?? [];
        }

        return $vouchers;
    }

    /**
     * @param  array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function cast(array $row): array
    {
        foreach ($row as $key => $value) {
            if ($value === null || !is_string($value)) {
                continue;
            }

            if (str_ends_with($key, '_amount') || str_ends_with($key, '_pct') || $key === 'discount_total') {
                $row[$key] = (float) $value;
            } elseif ($key === 'id' || str_ends_with($key, '_id') || $key === 'redemptions') {
                $row[$key] = (int) $value;
            }
        }

        return $row;
    }
}
