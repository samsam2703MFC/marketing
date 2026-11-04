<?php

declare(strict_types=1);

namespace Marketing\Service;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Les règles des supports d'une boutique : une bâche a ses dimensions (cm), une
 * affiche son format (A1, A2, A3). La validation est stricte : un champ inconnu
 * ou une valeur hors liste refuse l'envoi entier, champ nommé.
 */
final class ShopSupportService
{
    public const KINDS     = ['bache', 'affiche'];
    public const FORMATS   = ['A1', 'A2', 'A3'];
    public const MATERIALS = ['pvc', 'mesh'];
    public const FIXINGS   = ['oeillets', 'fourreaux', 'sangles'];
    public const MAX_PER_SHOP = 50;

    private const FIELDS = ['kind', 'placement', 'widthCm', 'heightCm', 'paperFormat', 'quantity', 'material', 'fixing', 'note'];

    /**
     * @param mixed $input `[{kind, placement?, widthCm?, heightCm?, paperFormat?, quantity?, material?, fixing?, note?}]`
     * @return array{rows:list<array<string,mixed>>, errors:list<array{field:string, message:string}>}
     */
    public function validate(mixed $input): array
    {
        $rows = [];
        $errors = [];
        if (!is_array($input) || !array_is_list($input)) {
            return ['rows' => [], 'errors' => [['field' => 'supports', 'message' => 'Liste attendue.']]];
        }
        if (count($input) > self::MAX_PER_SHOP) {
            return ['rows' => [], 'errors' => [['field' => 'supports', 'message' => self::MAX_PER_SHOP . ' supports au plus par boutique.']]];
        }

        foreach ($input as $i => $item) {
            $at = static fn (string $field): string => 'supports[' . $i . '].' . $field;
            if (!is_array($item)) {
                $errors[] = ['field' => 'supports[' . $i . ']', 'message' => 'Objet attendu.'];
                continue;
            }
            foreach (array_keys($item) as $key) {
                if (!in_array($key, self::FIELDS, true)) {
                    $errors[] = ['field' => $at((string) $key), 'message' => 'Champ inconnu.'];
                }
            }
            $kind = $item['kind'] ?? null;
            if (!in_array($kind, self::KINDS, true)) {
                $errors[] = ['field' => $at('kind'), 'message' => 'bache ou affiche.'];
                continue;
            }

            $quantity = $item['quantity'] ?? 1;
            if (!is_int($quantity) || $quantity < 1 || $quantity > 99) {
                $errors[] = ['field' => $at('quantity'), 'message' => 'Entier de 1 à 99.'];
            }
            $text = static function (mixed $value, int $max) : ?string {
                $value = trim((string) ($value ?? ''));
                return $value === '' ? null : mb_substr($value, 0, $max);
            };
            foreach (['placement' => 120, 'note' => 300] as $field => $max) {
                if (isset($item[$field]) && (!is_string($item[$field]) || mb_strlen(trim($item[$field])) > $max)) {
                    $errors[] = ['field' => $at($field), 'message' => 'Texte de ' . $max . ' caractères au plus.'];
                }
            }

            $row = [
                'kind' => $kind, 'placement' => $text($item['placement'] ?? null, 120), 'note' => $text($item['note'] ?? null, 300),
                'quantity' => is_int($quantity) ? $quantity : 1,
                'width_cm' => null, 'height_cm' => null, 'paper_format' => null, 'material' => null, 'fixing' => null,
            ];

            if ($kind === 'bache') {
                foreach (['widthCm' => 'width_cm', 'heightCm' => 'height_cm'] as $field => $column) {
                    $value = $item[$field] ?? null;
                    if (!is_int($value) || $value < 10 || $value > 2000) {
                        $errors[] = ['field' => $at($field), 'message' => 'Dimension en cm, de 10 à 2 000.'];
                    } else {
                        $row[$column] = $value;
                    }
                }
                foreach (['material' => self::MATERIALS, 'fixing' => self::FIXINGS] as $field => $allowed) {
                    $value = $item[$field] ?? null;
                    if ($value !== null && $value !== '' && !in_array($value, $allowed, true)) {
                        $errors[] = ['field' => $at($field), 'message' => 'Valeur acceptée : ' . implode(', ', $allowed) . '.'];
                    } else {
                        $row[$field] = $value === '' ? null : $value;
                    }
                }
                if (isset($item['paperFormat'])) {
                    $errors[] = ['field' => $at('paperFormat'), 'message' => 'Une bâche se décrit par ses dimensions, pas par un format A.'];
                }
            } else {
                $format = $item['paperFormat'] ?? null;
                if (!in_array($format, self::FORMATS, true)) {
                    $errors[] = ['field' => $at('paperFormat'), 'message' => 'A1, A2 ou A3.'];
                } else {
                    $row['paper_format'] = $format;
                }
                foreach (['widthCm', 'heightCm', 'material', 'fixing'] as $field) {
                    if (isset($item[$field])) {
                        $errors[] = ['field' => $at($field), 'message' => 'Propre aux bâches.'];
                    }
                }
            }
            $rows[] = $row;
        }

        return ['rows' => $errors === [] ? $rows : [], 'errors' => $errors];
    }

    /** @param array<string,mixed> $row */
    public function serialize(array $row): array
    {
        return [
            'id'          => (string) $row['id'],
            'shopId'      => (string) $row['shop_id'],
            'shopName'    => (string) ($row['shop_name'] ?? ''),
            'kind'        => (string) $row['kind'],
            'placement'   => $row['placement'],
            'widthCm'     => $row['width_cm'] !== null ? (int) $row['width_cm'] : null,
            'heightCm'    => $row['height_cm'] !== null ? (int) $row['height_cm'] : null,
            'paperFormat' => $row['paper_format'],
            'quantity'    => (int) $row['quantity'],
            'material'    => $row['material'],
            'fixing'      => $row['fixing'],
            'note'        => $row['note'],
            'updatedAt'   => (new DateTimeImmutable((string) $row['updated_at']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z'),
        ];
    }
}
