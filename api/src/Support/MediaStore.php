<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;

/**
 * Les fichiers de la médiathèque commune.
 *
 * Contrairement aux visuels de l'assistant (`ImageStore`, réduits au format
 * d'une carte 10 × 15), le fichier est gardé **tel qu'il arrive** : la même
 * photo sert à un post de 1 080 px et à une bâche de 3 m, et seul l'original
 * suffit à la seconde. Une vignette de 480 px sert aux grilles des écrans.
 *
 * Mêmes règles de prudence que `ImageStore` : le format est reconnu aux octets
 * d'en-tête, jamais au nom ni au type annoncés ; le nom écrit est tiré au hasard
 * (un nom deviné permettrait de lire un fichier qu'on ne vous a pas montré) ;
 * le SVG est refusé, parce qu'il peut porter du script et s'exécuterait dans
 * notre origine.
 */
final class MediaStore
{
    /** Une photo de reflex en pleine définition tient dans 20 Mio. */
    public const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

    /** La limite que la médiathèque de Social appliquait déjà aux vidéos. */
    public const VIDEO_MAX_BYTES = 45 * 1024 * 1024;

    /** Côté long des vignettes. */
    public const THUMB_LONG = 480;

    /**
     * Version web : 2 048 px de côté long, ce que Meta garde d'une photo. Tirée quand
     * l'original est plus grand ou plus lourd — un post n'envoie pas l'original d'une bâche.
     */
    public const WEB_LONG = 2048;
    public const WEB_MAX_BYTES = 2 * 1024 * 1024;

    /** Au-delà, on ne décode pas l'image pour en tirer les versions réduites (mémoire). */
    private const DECODE_MEMORY_CAP = 1536 * 1024 * 1024;

    /** Formats reconnus : extension → [nature, type MIME]. */
    private const FORMATS = [
        'png'  => ['image', 'image/png'],
        'jpg'  => ['image', 'image/jpeg'],
        'gif'  => ['image', 'image/gif'],
        'webp' => ['image', 'image/webp'],
        'avif' => ['image', 'image/avif'],
        'mp4'  => ['video', 'video/mp4'],
        'mov'  => ['video', 'video/quicktime'],
        'webm' => ['video', 'video/webm'],
    ];

    /**
     * Ce que sont les octets reçus, sans rien écrire.
     *
     * @return array{kind:'image'|'video', extension:string, mime:string, bytes:int,
     *               width:?int, height:?int, sha256:string}
     */
    public static function inspect(string $binary): array
    {
        if ($binary === '') {
            throw new RuntimeException('Fichier vide.');
        }

        $extension = self::sniff($binary);
        [$kind, $mime] = self::FORMATS[$extension];

        $limit = $kind === 'video' ? self::VIDEO_MAX_BYTES : self::IMAGE_MAX_BYTES;
        if (strlen($binary) > $limit) {
            throw new RuntimeException(sprintf(
                '%s trop lourde : %s, maximum %s.',
                $kind === 'video' ? 'Vidéo' : 'Image',
                ImageStore::humanBytes(strlen($binary)),
                ImageStore::humanBytes($limit)
            ));
        }

        [$width, $height] = $kind === 'image' ? self::dimensions($binary) : [null, null];

        return [
            'kind'      => $kind,
            'extension' => $extension,
            'mime'      => $mime,
            'bytes'     => strlen($binary),
            'width'     => $width,
            'height'    => $height,
            'sha256'    => hash('sha256', $binary),
        ];
    }

    /**
     * Écrit le fichier et sa vignette ; rend leurs chemins publics.
     *
     * Pour une vidéo, la vignette vient de `$poster` (l'image que le navigateur
     * tire de sa première seconde) : le serveur n'a pas de quoi lire une vidéo.
     *
     * @param  array{kind:string, extension:string} $info Le résultat de `inspect`.
     * @return array{path:string, thumb_path:?string, web_path:?string}
     */
    public static function write(string $binary, array $info, ?string $poster = null): array
    {
        $month     = date('Ym');
        $directory = ImageStore::directory() . '/media/' . $month;
        self::ensureWritable($directory);

        $stem = bin2hex(random_bytes(12));
        $name = $stem . '.' . $info['extension'];
        if (file_put_contents($directory . '/' . $name, $binary) === false) {
            throw new RuntimeException('Écriture du fichier impossible sur le serveur.');
        }

        $source  = $info['kind'] === 'image' ? $binary : $poster;
        $derived = $source !== null && $source !== '' ? self::derivatives($source, $info['kind'] === 'image') : ['thumb' => null, 'web' => null];
        $folder  = ImageStore::folder() . '/media/' . $month;
        $paths   = ['path' => $folder . '/' . $name, 'thumb_path' => null, 'web_path' => null];

        foreach (['thumb' => 'thumb_path', 'web' => 'web_path'] as $kind => $column) {
            $version = $derived[$kind];
            if ($version === null) {
                continue;
            }
            $file = $stem . '.' . $kind . '.' . $version['extension'];
            if (file_put_contents($directory . '/' . $file, $version['binary']) !== false) {
                $paths[$column] = $folder . '/' . $file;
            }
        }

        return $paths;
    }

    /**
     * Remplace la vignette d'un fichier déjà déposé (la couverture d'une vidéo).
     * Rend son chemin public, ou `null` si l'image n'a pas pu être réduite.
     */
    public static function writeThumbnail(string $filePath, string $image): ?string
    {
        $folder = ImageStore::folder() . '/';
        if (!str_starts_with($filePath, $folder . 'media/')) {
            throw new RuntimeException('Fichier hors de la médiathèque.');
        }
        $relative  = substr($filePath, strlen($folder));
        $directory = ImageStore::directory() . '/' . dirname($relative);
        self::ensureWritable($directory);

        $thumb = self::thumbnail($image);
        if ($thumb === null) {
            return null;
        }
        $stem = pathinfo($relative, PATHINFO_FILENAME);
        $name = $stem . '.thumb.' . $thumb['extension'];
        if (file_put_contents($directory . '/' . $name, $thumb['binary']) === false) {
            throw new RuntimeException('Écriture de la vignette impossible sur le serveur.');
        }

        return $folder . dirname($relative) . '/' . $name;
    }

    /** Extension déduite des octets d'en-tête. */
    public static function sniff(string $binary): string
    {
        $head = substr($binary, 0, 16);

        return match (true) {
            str_starts_with($head, "\x89PNG\r\n\x1a\n")                          => 'png',
            str_starts_with($head, "\xFF\xD8\xFF")                               => 'jpg',
            str_starts_with($head, 'GIF87a'), str_starts_with($head, 'GIF89a')   => 'gif',
            str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP'     => 'webp',
            str_starts_with($head, "\x1A\x45\xDF\xA3")                           => 'webm',
            substr($head, 4, 4) === 'ftyp'                                       => self::isoBrand(substr($head, 8, 4)),
            default => throw new RuntimeException(
                'Format non reconnu. Photos : PNG, JPEG, GIF, WebP, AVIF ; vidéos : MP4, MOV, WebM.'
            ),
        };
    }

    /** Une boîte `ftyp` ouvre l'AVIF comme le MP4 et le MOV : la marque les sépare. */
    private static function isoBrand(string $brand): string
    {
        return match ($brand) {
            'avif', 'avis' => 'avif',
            'qt  '         => 'mov',
            default        => 'mp4',
        };
    }

    /** La vignette d'une image (480 px), ou `null`. */
    public static function thumbnail(string $binary): ?array
    {
        return self::derivatives($binary, false)['thumb'];
    }

    /**
     * Les versions réduites d'une image, décodée une seule fois : la vignette (480 px)
     * et, si `$web` et que l'original est plus grand ou plus lourd, la version web
     * (2 048 px). JPEG — PNG si l'image a de la transparence (une photo détourée garde
     * son fond transparent). `null` sans GD, pour un format que GD ne lit pas, ou quand
     * l'image demanderait plus de mémoire que le serveur n'en accorde : l'écran montre
     * alors l'original, ce qui reste juste, seulement plus lourd.
     *
     * @return array{thumb:?array{binary:string, extension:string}, web:?array{binary:string, extension:string}}
     */
    public static function derivatives(string $binary, bool $web = true): array
    {
        $none = ['thumb' => null, 'web' => null];
        if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) {
            return $none;
        }

        try {
            $extension = self::sniff($binary);
        } catch (RuntimeException) {
            return $none;
        }
        if (!in_array($extension, ['png', 'jpg', 'gif', 'webp'], true)) {
            return $none;
        }

        [$width, $height] = self::dimensions($binary);
        if ($width === null || $height === null || $width < 1 || $height < 1 || !self::reserveMemory($width, $height, strlen($binary))) {
            return $none;
        }

        $source = @imagecreatefromstring($binary);
        if ($source === false) {
            return $none;
        }
        $alpha = $extension !== 'jpg';

        $thumbCanvas = self::resize($source, self::THUMB_LONG, $alpha);
        // Une image à canal alpha qui n'en use pas part en JPEG : dix fois plus légère.
        $transparent = $alpha && self::hasTransparency($thumbCanvas, imagesx($thumbCanvas), imagesy($thumbCanvas));
        $result = ['thumb' => self::encode($thumbCanvas, $transparent, 82), 'web' => null];

        if ($web && (max($width, $height) > self::WEB_LONG || strlen($binary) > self::WEB_MAX_BYTES)) {
            $result['web'] = self::encode(self::resize($source, self::WEB_LONG, $alpha), $transparent, 88);
        }
        imagedestroy($source);

        return $result;
    }

    /** L'image réduite à `$long` px de côté long (jamais agrandie). */
    private static function resize(\GdImage $source, int $long, bool $alpha): \GdImage
    {
        $width  = imagesx($source);
        $height = imagesy($source);
        $ratio  = min(1, $long / max($width, $height, 1));
        $tw     = max(1, (int) round($width * $ratio));
        $th     = max(1, (int) round($height * $ratio));

        $canvas = imagecreatetruecolor($tw, $th);
        if ($alpha) {
            imagealphablending($canvas, false);
            imagesavealpha($canvas, true);
            imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));
        }
        imagecopyresampled($canvas, $source, 0, 0, 0, 0, $tw, $th, $width, $height);

        return $canvas;
    }

    /** @return array{binary:string, extension:string}|null */
    private static function encode(\GdImage $canvas, bool $png, int $quality): ?array
    {
        ob_start();
        $written = $png ? imagepng($canvas, null, 6) : imagejpeg($canvas, null, $quality);
        $output  = (string) ob_get_clean();
        imagedestroy($canvas);

        return $written && $output !== '' ? ['binary' => $output, 'extension' => $png ? 'png' : 'jpg'] : null;
    }

    /**
     * Assez de mémoire pour décoder l'image ? GD tient quatre octets par pixel : une
     * photo de 8 000 × 8 000 en demande 256 Mo, plus que la limite courante de PHP. On
     * relève la limite pour ce décodage s'il le faut (jusqu'à 1,5 Go) ; sinon on renonce
     * aux versions réduites plutôt que de faire échouer le dépôt.
     */
    private static function reserveMemory(int $width, int $height, int $bytes): bool
    {
        $need  = $width * $height * 5 + $bytes * 2 + 32 * 1024 * 1024;
        $limit = self::iniBytes((string) ini_get('memory_limit'));
        if ($limit === null) {
            return $need <= self::DECODE_MEMORY_CAP * 2;
        }
        $used = memory_get_usage(true);
        if ($used + $need <= $limit) {
            return true;
        }
        $wanted = $used + $need;
        if ($wanted > self::DECODE_MEMORY_CAP) {
            return false;
        }

        return @ini_set('memory_limit', (string) $wanted) !== false
            && (self::iniBytes((string) ini_get('memory_limit')) ?? PHP_INT_MAX) >= $wanted;
    }

    /** Une taille de php.ini (`8M`, `1G`, `512K`) en octets ; nul pour « pas de limite ». */
    public static function iniBytes(string $value): ?int
    {
        $value = trim($value);
        if ($value === '' || $value === '0' || $value === '-1') {
            return null;
        }
        $number = (int) $value;

        return $number * match (strtoupper(substr($value, -1))) {
            'G'     => 1024 ** 3,
            'M'     => 1024 ** 2,
            'K'     => 1024,
            default => 1,
        };
    }

    /** Vrai si un pixel au moins n'est pas opaque (sondage d'une grille de 24 × 24). */
    private static function hasTransparency(\GdImage $image, int $width, int $height): bool
    {
        $stepX = max(1, intdiv($width, 24));
        $stepY = max(1, intdiv($height, 24));
        for ($y = 0; $y < $height; $y += $stepY) {
            for ($x = 0; $x < $width; $x += $stepX) {
                if (((imagecolorat($image, $x, $y) >> 24) & 0x7F) > 0) {
                    return true;
                }
            }
        }

        return false;
    }

    /** @return array{0:?int, 1:?int} */
    private static function dimensions(string $binary): array
    {
        if (!function_exists('getimagesizefromstring')) {
            return [null, null];
        }
        $size = @getimagesizefromstring($binary);

        return is_array($size) ? [(int) $size[0], (int) $size[1]] : [null, null];
    }

    private static function ensureWritable(string $directory): void
    {
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException(sprintf(
                'Dossier de la médiathèque absent et impossible à créer : %s. Donnez l\'écriture '
                . 'du dossier des envois au compte du serveur web, ou renseignez MAR_UPLOAD_DIR.',
                $directory
            ));
        }
        if (!is_writable($directory)) {
            throw new RuntimeException(sprintf(
                'Dossier de la médiathèque non inscriptible : %s. Le serveur web tourne sous « %s ».',
                $directory,
                ImageStore::serverUser()
            ));
        }
    }
}
