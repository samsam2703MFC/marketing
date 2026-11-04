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
     * @return array{path:string, thumb_path:?string}
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

        $source = $info['kind'] === 'image' ? $binary : $poster;
        $thumb  = $source !== null && $source !== '' ? self::thumbnail($source) : null;
        $thumbName = null;
        if ($thumb !== null) {
            $thumbName = $stem . '.thumb.' . $thumb['extension'];
            if (file_put_contents($directory . '/' . $thumbName, $thumb['binary']) === false) {
                $thumbName = null;
            }
        }

        $folder = ImageStore::folder() . '/media/' . $month;

        return [
            'path'       => $folder . '/' . $name,
            'thumb_path' => $thumbName !== null ? $folder . '/' . $thumbName : null,
        ];
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

    /**
     * La vignette d'une image : 480 px de côté long, en JPEG — en PNG si l'image
     * a de la transparence (une photo détourée garde son fond transparent).
     * `null` sans GD, ou pour un format que GD ne lit pas : l'écran montre alors
     * l'original, ce qui reste juste, seulement plus lourd.
     *
     * @return array{binary:string, extension:string}|null
     */
    public static function thumbnail(string $binary): ?array
    {
        if (!function_exists('imagecreatefromstring') || !function_exists('imagecopyresampled')) {
            return null;
        }

        try {
            $extension = self::sniff($binary);
        } catch (RuntimeException) {
            return null;
        }
        if (!in_array($extension, ['png', 'jpg', 'gif', 'webp'], true)) {
            return null;
        }

        $source = @imagecreatefromstring($binary);
        if ($source === false) {
            return null;
        }

        $width  = imagesx($source);
        $height = imagesy($source);
        $ratio  = min(1, self::THUMB_LONG / max($width, $height, 1));
        $tw     = max(1, (int) round($width * $ratio));
        $th     = max(1, (int) round($height * $ratio));
        $alpha  = $extension !== 'jpg';

        $canvas = imagecreatetruecolor($tw, $th);
        if ($alpha) {
            imagealphablending($canvas, false);
            imagesavealpha($canvas, true);
            imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));
        }
        imagecopyresampled($canvas, $source, 0, 0, 0, 0, $tw, $th, $width, $height);
        imagedestroy($source);

        // Une image à canal alpha qui n'en use pas part en JPEG : dix fois plus légère.
        $transparent = $alpha && self::hasTransparency($canvas, $tw, $th);

        ob_start();
        $written = $transparent ? imagepng($canvas, null, 6) : imagejpeg($canvas, null, 82);
        $output  = (string) ob_get_clean();
        imagedestroy($canvas);

        return $written && $output !== '' ? ['binary' => $output, 'extension' => $transparent ? 'png' : 'jpg'] : null;
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
