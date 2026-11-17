<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Les allergènes et le poids d'un produit pour le catalogue imprimé (17/11/2026, Sam : « ajouter le poids, ajouter les
 * allergènes — obligatoire », avec leur explication sur l'avant-dernière page).
 *
 * Les allergènes : les 14 du règlement (UE) n° 1169/2011, annexe II, dans cet ordre. L'ERP les donne en mots dans
 * `grouped_allergens` de `GET /api/v1/shops/{id}/products/available` — ceux de la recette du produit, par exemple
 * « Céréales contenant du gluten, Œufs, Lait ». Un mot inconnu ne devient rien (jamais un allergène deviné) ; une trace
 * (« peut contenir », « traces de ») n'est pas un ingrédient et n'est pas reprise.
 *
 * Le poids : `single_weight` de l'ERP (grammes, « Poids d'une pièce ») quand il est saisi, sinon celui que porte le nom
 * du produit (« Cougnou Nature - 400 g. », « 1 kg ») ; rien d'autre.
 */
final class Allergens
{
    /** Les 14 allergènes, dans l'ordre de l'annexe II. */
    public const CODES = ['gluten', 'crustaces', 'oeufs', 'poisson', 'arachides', 'soja', 'lait', 'fruits_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques'];

    /** Les mots qui les nomment (minuscules, sans accent) : français, néerlandais, anglais. */
    private const MOTS = [
        'gluten'       => ['gluten', 'cereales', 'ble', 'froment', 'seigle', 'orge', 'avoine', 'epeautre', 'kamut', 'granen', 'tarwe', 'rogge', 'gerst', 'haver', 'spelt', 'wheat', 'rye', 'barley', 'oats'],
        'crustaces'    => ['crustaces', 'crustace', 'schaaldieren', 'schaaldier', 'crustaceans', 'crustacean'],
        'oeufs'        => ['oeufs', 'oeuf', 'eieren', 'eggs', 'egg'],
        'poisson'      => ['poissons', 'poisson', 'vis', 'fish'],
        'arachides'    => ['arachides', 'arachide', 'cacahuetes', 'cacahuete', 'pindas', 'pinda', 'aardnoten', 'peanuts', 'peanut'],
        'soja'         => ['soja', 'soya', 'soy', 'sojabonen'],
        'lait'         => ['lait', 'lactose', 'melk', 'milk'],
        'fruits_coque' => ['fruits a coque', 'fruit a coque', 'noix', 'noisettes', 'noisette', 'amandes', 'amande', 'cajou', 'pistaches', 'pistache', 'pecan', 'macadamia',
            'noten', 'schaalvruchten', 'amandelen', 'hazelnoten', 'walnoten', 'nuts', 'almonds', 'hazelnuts', 'walnuts'],
        'celeri'       => ['celeri', 'selderij', 'celery'],
        'moutarde'     => ['moutarde', 'mosterd', 'mustard'],
        'sesame'       => ['sesame', 'sesam', 'sesamzaad'],
        'sulfites'     => ['sulfites', 'sulfite', 'sulfureux', 'soufre', 'sulfieten', 'zwaveldioxide', 'sulphites', 'sulphur', 'sulfur'],
        'lupin'        => ['lupin', 'lupine', 'lupinen'],
        'mollusques'   => ['mollusques', 'mollusque', 'weekdieren', 'weekdier', 'molluscs', 'mollusks'],
    ];

    /** Une trace, un doute, une négation : le morceau n'est pas un ingrédient. */
    private const PIEGES = '/\b(traces?|sporen|peut contenir|peuvent contenir|kan bevatten|may contain|sans|zonder|geen|aucun|aucune|none|niet)\b/';

    /** @return list<string> les codes, dans l'ordre de l'annexe II, sans doublon. */
    public static function fromText(?string $text): array
    {
        $t = self::norm((string) $text);
        if ($t === '') {
            return [];
        }
        $vus = [];
        foreach (preg_split('/[,;\/\n]+/', $t) ?: [] as $morceau) {
            $morceau = trim($morceau);
            if ($morceau === '' || preg_match(self::PIEGES, $morceau) === 1 || str_contains($morceau, 'noix de coco')) {
                continue;
            }
            foreach (self::MOTS as $code => $mots) {
                foreach ($mots as $mot) {
                    if (preg_match('/(^|[^a-z])' . preg_quote($mot, '/') . '($|[^a-z])/', $morceau) === 1) {
                        $vus[$code] = true;
                        break;
                    }
                }
            }
        }

        return array_values(array_filter(self::CODES, static fn (string $c): bool => isset($vus[$c])));
    }

    /** Le poids d'une pièce, en grammes : celui de l'ERP, sinon celui du nom ; null sans l'un ni l'autre. */
    public static function weightGrams(mixed $singleWeight, string $name): ?int
    {
        if (is_numeric($singleWeight) && (float) $singleWeight >= 1) {
            return (int) round((float) $singleWeight);
        }
        if (preg_match('/(\d+(?:[.,]\d+)?)\s*(kg|gr|g)\b\.?/iu', $name, $m) === 1) {
            $g = (float) str_replace(',', '.', $m[1]) * (strtolower($m[2]) === 'kg' ? 1000 : 1);
            return $g >= 1 ? (int) round($g) : null;
        }

        return null;
    }

    private static function norm(string $s): string
    {
        $s = mb_strtolower(trim($s));
        $s = strtr($s, ['œ' => 'oe', 'æ' => 'ae', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o', 'û' => 'u', 'ù' => 'u', 'ü' => 'u', 'ç' => 'c', '’' => "'"]);
        // « Anhydride sulfureux et sulfites », « Lait et produits à base de lait » : un seul allergène, quel que soit le lien.
        return (string) preg_replace('/\s+(et|en|and|of|ou)\s+/', ', ', $s);
    }
}
