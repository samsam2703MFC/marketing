<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Le prix après promotion, calculé une fois pour tout le module.
 *
 * Il n'est stocké nulle part : il se déduit du prix de départ et de la mécanique
 * choisie. Tant qu'il ne servait qu'au dossier d'impression, il pouvait vivre
 * dans son dépôt ; à partir du moment où la vitrine l'affiche aussi, le laisser
 * là reviendrait à écrire la règle deux fois — et à en corriger une seule le
 * jour où une mécanique change.
 *
 * Quatre mécaniques donnent un prix, une cinquième n'en donne pas :
 *
 * — `PERCENT` : une remise en pourcentage ;
 * — `CROSSED_PRICE` et `BUNDLE_FIXED` : un prix imposé, qui remplace l'autre ;
 * — `BUY_X_GET_Y` : le lot se vend au prix des articles achetés mais compte
 *   aussi les offerts. C'est la recette moyenne par pièce qui baisse, pas le
 *   prix affiché en rayon — d'où un « prix après » qui ne s'affiche pas en
 *   vitrine mais sert au calcul de marge ;
 * — `FREE_DELIVERY` : rien à recalculer, seulement une phrase.
 */
final class OfferPricing
{
    /** TVA belge sur l'alimentaire à emporter. */
    public const TVA_PCT = 6.0;

    /**
     * @param  array<string,mixed> $item   Ligne d'offre : mécanique et paramètres.
     * @param  float|null          $before Prix de départ, déjà résolu par l'appelant.
     * @return array{before:?float, after:?float, before_ht:?float, after_ht:?float,
     *               mechanic:?array{type:string, value:?float, buy:?int, get:?int, text:?string}}
     */
    public static function apply(array $item, ?float $before): array
    {
        $mecanique = (string) ($item['mechanic_type'] ?? '');
        $remise    = $item['discount_pct'] === null ? null : (float) $item['discount_pct'];
        $impose    = $item['fixed_price'] === null ? null : (float) $item['fixed_price'];
        $achetes   = $item['buy_qty'] === null ? null : (int) $item['buy_qty'];
        $offerts   = $item['get_qty'] === null ? null : (int) $item['get_qty'];

        $after = null;
        $texte = null;

        if ($before !== null) {
            if ($mecanique === 'PERCENT' && $remise !== null) {
                $after = round($before * (1 - $remise / 100), 2);
                $texte = sprintf('−%s %%', rtrim(rtrim(number_format($remise, 2, ',', ' '), '0'), ','));
            } elseif (($mecanique === 'CROSSED_PRICE' || $mecanique === 'BUNDLE_FIXED') && $impose !== null) {
                $after = round($impose, 2);
                $texte = number_format($after, 2, ',', ' ') . ' €';
            } elseif ($mecanique === 'BUY_X_GET_Y' && $achetes !== null && $offerts !== null
                      && $achetes > 0 && $offerts > 0) {
                $after = round(($before * $achetes) / ($achetes + $offerts), 2);
                $texte = sprintf('%d + %d offert%s', $achetes, $offerts, $offerts > 1 ? 's' : '');
            } elseif ($mecanique === 'FREE_DELIVERY') {
                $texte = 'Livraison offerte';
            }
        }

        return [
            'before'    => $before,
            'after'     => $after,
            'before_ht' => $before === null ? null : round($before / (1 + self::TVA_PCT / 100), 4),
            'after_ht'  => $after === null ? null : round($after / (1 + self::TVA_PCT / 100), 4),
            'mechanic'  => $mecanique === '' ? null : [
                'type'  => $mecanique,
                'value' => $remise ?? $impose ?? null,
                'buy'   => $achetes,
                'get'   => $offerts,
                'text'  => $texte,
            ],
        ];
    }
}
