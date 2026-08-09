<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;

/**
 * Stockage des images envoyées depuis l'assistant.
 *
 * Le visuel d'une campagne se saisissait par son adresse : il fallait donc
 * l'avoir déjà publiée quelque part. Les fichiers arrivent ici en base64 dans
 * le corps JSON — la forme que le reste du module utilise déjà, plutôt qu'un
 * envoi multipart qui obligerait `Request` à porter `$_FILES` pour un seul
 * appel.
 *
 * Rien de ce que le client annonce n'est cru : ni le nom du fichier, ni son
 * type déclaré. Le format est reconnu aux octets d'en-tête, et le nom est
 * réécrit — un « photo.png » qui contiendrait du PHP finirait sinon exécuté
 * par le serveur qui le sert.
 */
final class ImageStore
{
    /** 3 Mio : un visuel de campagne pèse moins, et le corps JSON en fait 4. */
    private const MAX_BYTES = 3 * 1024 * 1024;

    /**
     * Signatures acceptées, de la plus longue à la plus courte.
     *
     * Le SVG n'y figure pas : c'est un document, il peut porter du script, et
     * servi depuis notre domaine il s'exécuterait dans notre origine.
     *
     * @var array<string, list<string>>
     */
    private const SIGNATURES = [
        'png'  => ["\x89PNG\r\n\x1a\n"],
        'jpg'  => ["\xFF\xD8\xFF"],
        'gif'  => ['GIF87a', 'GIF89a'],
        'webp' => ['RIFF'],
        'avif' => ["\x00\x00\x00 ftypavif", "\x00\x00\x00\x1cftypavif"],
    ];

    /**
     * Format d'impression visé : 100 × 150 mm à 300 dpi.
     *
     *   sans fond perdu  : 1 182 × 1 772 px  (100 × 150 mm)
     *   avec 3 mm perdus : 1 252 × 1 843 px  (106 × 156 mm)
     *
     * Les bornes sont exprimées par côté long et côté court, non par largeur
     * et hauteur : un visuel à l'italienne vise le même format, couché.
     *
     * Au-delà, l'image est réduite à l'envoi. Ce n'est pas de l'esthétique :
     * une photo de téléphone fait cinq mille pixels de large et quatre méga —
     * elle passait donc à peine la limite de poids, pour finir affichée dans
     * un cadre de 260 px et imprimée à 1 252.
     */
    private const PRINT_MAX_LONG  = 1843;
    private const PRINT_MAX_SHORT = 1252;

    /** En deçà, l'impression à 300 dpi perd en netteté. */
    private const PRINT_MIN_LONG  = 1772;
    private const PRINT_MIN_SHORT = 1182;

    /**
     * Écrit l'image, réduite au format d'impression, et rend son chemin.
     *
     * @param  string $content Contenu base64, avec ou sans préfixe `data:`.
     * @return array{path:string, bytes:int, width:?int, height:?int,
     *               original_width:?int, original_height:?int,
     *               resized:bool, below_print:bool}
     */
    public static function store(string $content): array
    {
        $binary = self::decode($content);

        if ($binary === '') {
            throw new RuntimeException('Fichier vide.');
        }

        if (strlen($binary) > self::MAX_BYTES) {
            throw new RuntimeException(sprintf(
                'Image trop lourde : %s, maximum %s.',
                self::humanBytes(strlen($binary)),
                self::humanBytes(self::MAX_BYTES)
            ));
        }

        $extension = self::sniff($binary);
        $directory = self::directory();

        if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('Dossier des visuels impossible à créer sur le serveur.');
        }

        if (!is_writable($directory)) {
            throw new RuntimeException('Dossier des visuels non inscriptible sur le serveur.');
        }

        [$originalWidth, $originalHeight] = self::dimensions($binary);

        // Réduction au format d'impression. Elle ne s'applique qu'au-delà :
        // agrandir une petite image n'ajouterait aucun détail, seulement du
        // poids et un flou.
        $resized = false;
        $scaled  = self::downscale($binary, $extension);
        if ($scaled !== null) {
            $binary  = $scaled;
            $resized = true;
        }

        [$width, $height] = $resized ? self::dimensions($binary) : [$originalWidth, $originalHeight];

        // Nom tiré au sort : deux campagnes peuvent envoyer « visuel.jpg », et
        // un nom deviné permettrait de lire le visuel d'une campagne voisine.
        $name = bin2hex(random_bytes(10)) . '.' . $extension;

        if (file_put_contents($directory . '/' . $name, $binary) === false) {
            throw new RuntimeException('Écriture du visuel impossible sur le serveur.');
        }

        return [
            'path'            => self::folder() . '/' . $name,
            'bytes'           => strlen($binary),
            'width'           => $width,
            'height'          => $height,
            'original_width'  => $originalWidth,
            'original_height' => $originalHeight,
            'resized'         => $resized,
            'below_print'     => self::belowPrint($width, $height),
        ];
    }

    /**
     * Dimensions de l'image, ou deux `null`.
     *
     * La lecture sert à l'affichage et au calcul de réduction, pas à la
     * validation : son absence ne doit pas faire échouer un envoi valable.
     *
     * @return array{0:?int, 1:?int}
     */
    private static function dimensions(string $binary): array
    {
        if (!function_exists('getimagesizefromstring')) {
            return [null, null];
        }

        $size = @getimagesizefromstring($binary);

        return is_array($size) ? [(int) $size[0], (int) $size[1]] : [null, null];
    }

    /** Vrai si l'image est trop petite pour être imprimée nettement. */
    private static function belowPrint(?int $width, ?int $height): bool
    {
        if ($width === null || $height === null) {
            return false;
        }

        return max($width, $height) < self::PRINT_MIN_LONG
            || min($width, $height) < self::PRINT_MIN_SHORT;
    }

    /**
     * Image réduite au format d'impression, ou `null` s'il n'y a rien à faire.
     *
     * Sans GD, l'image part telle quelle : mieux vaut un visuel trop grand
     * qu'un envoi refusé pour une extension manquante sur le serveur. Le GIF
     * et l'AVIF ne sont pas retouchés — le premier peut être animé et la
     * réduction n'en garderait qu'une image, le second n'est pas gravé dans
     * toutes les compilations de GD.
     */
    private static function downscale(string $binary, string $extension): ?string
    {
        if (!in_array($extension, ['png', 'jpg', 'webp'], true)) {
            return null;
        }

        if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) {
            return null;
        }

        [$width, $height] = self::dimensions($binary);
        if ($width === null || $height === null || $width < 1 || $height < 1) {
            return null;
        }

        $long  = max($width, $height);
        $short = min($width, $height);
        $scale = min(1.0, self::PRINT_MAX_LONG / $long, self::PRINT_MAX_SHORT / $short);

        if ($scale >= 1.0) {
            return null;
        }

        $source = @imagecreatefromstring($binary);
        if ($source === false) {
            return null;
        }

        $newWidth  = max(1, (int) round($width * $scale));
        $newHeight = max(1, (int) round($height * $scale));
        $canvas    = @imagecreatetruecolor($newWidth, $newHeight);

        if ($canvas === false) {
            imagedestroy($source);

            return null;
        }

        // La transparence se perdrait sur un fond noir : le PNG et le WebP
        // gardent leur canal alpha, que le visuel se détoure sur la couleur
        // du support imprimé.
        if ($extension !== 'jpg') {
            imagealphablending($canvas, false);
            imagesavealpha($canvas, true);
            $transparent = imagecolorallocatealpha($canvas, 0, 0, 0, 127);
            if ($transparent !== false) {
                imagefilledrectangle($canvas, 0, 0, $newWidth, $newHeight, $transparent);
            }
        }

        imagecopyresampled($canvas, $source, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

        ob_start();
        $written = match ($extension) {
            'png'  => imagepng($canvas, null, 6),
            'webp' => function_exists('imagewebp') ? imagewebp($canvas, null, 88) : false,
            default => imagejpeg($canvas, null, 88),
        };
        $output = (string) ob_get_clean();

        imagedestroy($canvas);
        imagedestroy($source);

        return $written && $output !== '' ? $output : null;
    }

    /** Base64 strict, préfixe `data:` retiré. */
    private static function decode(string $content): string
    {
        $content = trim($content);

        if (str_starts_with($content, 'data:')) {
            $comma = strpos($content, ',');
            if ($comma === false) {
                throw new RuntimeException('Contenu illisible.');
            }
            $content = substr($content, $comma + 1);
        }

        $binary = base64_decode(preg_replace('/\s+/', '', $content) ?? '', true);

        if ($binary === false) {
            throw new RuntimeException('Contenu illisible : ce n\'est pas du base64.');
        }

        return $binary;
    }

    /** Extension déduite des octets d'en-tête. */
    private static function sniff(string $binary): string
    {
        foreach (self::SIGNATURES as $extension => $magics) {
            foreach ($magics as $magic) {
                if (str_starts_with($binary, $magic)) {
                    // `RIFF` ouvre aussi des fichiers audio : le WebP se
                    // reconnaît au marqueur qui suit la taille.
                    if ($extension === 'webp' && substr($binary, 8, 4) !== 'WEBP') {
                        continue;
                    }

                    return $extension;
                }
            }
        }

        throw new RuntimeException(
            'Format non reconnu. Formats acceptés : PNG, JPEG, GIF, WebP, AVIF.'
        );
    }

    /** Nom du dossier public, tel qu'il apparaît dans l'adresse. */
    private static function folder(): string
    {
        return trim((string) (Env::get('MAR_UPLOAD_FOLDER', 'uploads') ?: 'uploads'), '/');
    }

    /**
     * Dossier d'écriture.
     *
     * Configurable, sinon deviné : `public/uploads` quand le dépôt est là
     * (développement, où Vite sert ce dossier), la racine publiée sinon —
     * `rsync` déployant sans `--delete`, les visuels y survivent aux mises à
     * jour.
     */
    private static function directory(): string
    {
        $configured = trim((string) (Env::get('MAR_UPLOAD_DIR', '') ?: ''));
        if ($configured !== '') {
            return rtrim($configured, '/');
        }

        $root = dirname(__DIR__, 3);

        return is_dir($root . '/public')
            ? $root . '/public/' . self::folder()
            : $root . '/' . self::folder();
    }

    private static function humanBytes(int $bytes): string
    {
        return $bytes >= 1024 * 1024
            ? sprintf('%.1f Mo', $bytes / 1024 / 1024)
            : sprintf('%d Ko', (int) round($bytes / 1024));
    }
}
