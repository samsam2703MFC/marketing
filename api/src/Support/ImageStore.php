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
     * Écrit l'image et rend son chemin, relatif à la racine publique.
     *
     * @param  string $content Contenu base64, avec ou sans préfixe `data:`.
     * @return array{path:string, bytes:int, width:?int, height:?int}
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

        // Nom tiré au sort : deux campagnes peuvent envoyer « visuel.jpg », et
        // un nom deviné permettrait de lire le visuel d'une campagne voisine.
        $name = bin2hex(random_bytes(10)) . '.' . $extension;

        if (file_put_contents($directory . '/' . $name, $binary) === false) {
            throw new RuntimeException('Écriture du visuel impossible sur le serveur.');
        }

        // Lecture des dimensions seulement si la fonction est disponible : elle
        // sert à l'affichage, pas à la validation, et son absence ne doit pas
        // faire échouer un envoi par ailleurs valable.
        $width  = null;
        $height = null;
        if (function_exists('getimagesizefromstring')) {
            $size = @getimagesizefromstring($binary);
            if (is_array($size)) {
                $width  = (int) $size[0];
                $height = (int) $size[1];
            }
        }

        return [
            'path'   => self::folder() . '/' . $name,
            'bytes'  => strlen($binary),
            'width'  => $width,
            'height' => $height,
        ];
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
