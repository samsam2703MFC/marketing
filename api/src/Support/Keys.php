<?php

declare(strict_types=1);

namespace Marketing\Support;

use RuntimeException;
use Throwable;

/**
 * Les secrets du module, chiffrés en base — dans `erp_cles`, la table des clés commune à tout l'ERP
 * (décision du 7 nov. 2026 : « les clés dans une table commune pour tout l'ERP ; à part les clés, les
 * portails sont indépendants »). Les lignes du Marketing y portent `portail = mar` et le nom
 * `mar.{module}.{nom}` (`mar.marketing.MAR_SESSION_SECRET`, `mar.social.meta_system_token`) ; leur
 * valeur reste CHIFFRÉE (les clés `commun` des autres portails — Meta, SMS, IA… — sont en clair,
 * lues par leur nom). L'ancienne table `mar_keys` a été versée une fois (migration 046) et n'est
 * plus lue qu'en repli tant qu'elle existe.
 *
 * Jetons des API, mots de passe de service, secret de session : une copie de la
 * base ne doit en livrer aucun. Chaque valeur est chiffrée avec une clé maîtresse
 * de 32 octets qui vit **hors de la base**, dans un fichier du serveur
 * (`MAR_KEYS_FILE`, à défaut `master.key` à côté du fichier de configuration) —
 * la garder à côté de ce qu'elle protège ne protégerait rien.
 *
 * Format stocké : `x1:` + base64(nonce 24 o ‖ chiffré) en XChaCha20-Poly1305
 * (libsodium), ou `g1:` + base64(iv 12 o ‖ tag 16 o ‖ chiffré) en AES-256-GCM
 * (OpenSSL) quand libsodium manque. Les données associées sont
 * `mar_keys:{module}:{nom}` : une valeur recopiée sous un autre nom ne se
 * déchiffre pas. Le module Social lit et écrit ses propres clés (`module =
 * social`) avec le même format et la même clé maîtresse.
 *
 * Une clé ne sort jamais vers le navigateur ni dans un journal : l'écran ne
 * reçoit que son nom, ses quatre derniers caractères et sa date.
 *
 * Transition : tant qu'une clé n'est pas en base, elle est lue dans
 * l'environnement (le `.env` d'avant), pour que rien ne casse au déploiement.
 */
final class Keys
{
    public const MODULES = ['marketing', 'social'];

    /** @var array<string, array<string, array{ciphertext:string, hint:?string, description:?string, updated_at:string}>> */
    private static array $rows = [];

    /** @var array<string, string|null> */
    private static array $plain = [];

    private static ?string $master = null;

    /** La clé, déchiffrée ; à défaut celle de l'environnement ; `null` si aucune. */
    public static function get(string $name, string $module = 'marketing'): ?string
    {
        // Seul ce qui vient de la base est gardé en mémoire : l'environnement se relit à chaque fois.
        $cacheKey = $module . ':' . $name;
        if (!array_key_exists($cacheKey, self::$plain)) {
            $row = self::rows($module)[$name] ?? null;
            self::$plain[$cacheKey] = $row !== null ? self::decrypt($row['ciphertext'], $module, $name) : null;
        }
        $value = self::$plain[$cacheKey];
        if ($value === null && $module === 'marketing') {
            $fromEnv = Env::get($name);
            $value = $fromEnv !== null && $fromEnv !== '' ? $fromEnv : null;
        }

        return $value;
    }

    /** Enregistre une clé (la remplace si elle existe). */
    public static function put(string $name, string $value, string $module = 'marketing', ?int $userId = null, ?string $description = null): void
    {
        self::assertName($name, $module);
        if ($value === '') {
            throw new RuntimeException('Une clé vide ne s\'enregistre pas : retirez-la plutôt.');
        }

        $statement = Database::connection()->prepare(
            "INSERT INTO erp_cles (cle, valeur, secret, indice, portail, integration, maj_le, maj_par)
             VALUES (:cle, :valeur, 1, :indice, 'mar', :integration, NOW(), :par)
             ON DUPLICATE KEY UPDATE valeur = VALUES(valeur), indice = VALUES(indice),
                                     integration = COALESCE(VALUES(integration), integration), maj_le = NOW(), maj_par = VALUES(maj_par)"
        );
        $statement->execute([
            'cle'         => self::cle($module, $name),
            'valeur'      => self::encrypt($value, $module, $name),
            'indice'      => self::hint($value),
            'integration' => $description !== null ? mb_substr($description, 0, 60) : null,
            'par'         => $userId !== null ? (string) $userId : null,
        ]);
        self::forget();
    }

    public static function delete(string $name, string $module = 'marketing'): bool
    {
        $statement = Database::connection()->prepare('DELETE FROM erp_cles WHERE cle = :cle');
        $statement->execute(['cle' => self::cle($module, $name)]);
        $n = $statement->rowCount();
        try {
            $old = Database::connection()->prepare('DELETE FROM mar_keys WHERE module = :module AND name = :name');
            $old->execute(['module' => $module, 'name' => $name]);
            $n += $old->rowCount();
        } catch (Throwable) {
            // l'ancienne table n'existe plus
        }
        self::forget();

        return $n > 0;
    }

    /**
     * Ce que l'écran peut savoir des clés : nom, quatre derniers caractères, date,
     * et si la clé se déchiffre avec la clé maîtresse de ce serveur.
     *
     * @return list<array{name:string, hint:?string, description:?string, updated_at:string, readable:bool}>
     */
    public static function describe(string $module = 'marketing'): array
    {
        $out = [];
        foreach (self::rows($module) as $name => $row) {
            $out[] = [
                'name'        => $name,
                'hint'        => $row['hint'],
                'description' => $row['description'],
                'updated_at'  => $row['updated_at'],
                'readable'    => self::decrypt($row['ciphertext'], $module, $name) !== null,
            ];
        }

        return $out;
    }

    /** Vrai si la clé maîtresse est là (ou peut être créée) : les clés peuvent s'écrire. */
    public static function available(): bool
    {
        try {
            return self::master(false) !== null || self::masterPath() !== null && is_writable(dirname((string) self::masterPath()));
        } catch (Throwable) {
            return false;
        }
    }

    /** Oublie ce qui a été lu (après une écriture, ou entre deux tests). */
    public static function forget(): void
    {
        self::$rows  = [];
        self::$plain = [];
        self::$master = null;
    }

    public static function encrypt(string $value, string $module, string $name): string
    {
        $key = self::master(true);
        $ad  = 'mar_keys:' . $module . ':' . $name;

        if (function_exists('sodium_crypto_aead_xchacha20poly1305_ietf_encrypt')) {
            $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);

            return 'x1:' . base64_encode($nonce . sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($value, $ad, $nonce, $key));
        }

        $iv  = random_bytes(12);
        $tag = '';
        $ct  = openssl_encrypt($value, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $ad, 16);
        if ($ct === false) {
            throw new RuntimeException('Chiffrement impossible : ni libsodium ni OpenSSL ne répondent.');
        }

        return 'g1:' . base64_encode($iv . $tag . $ct);
    }

    /** La valeur en clair, ou `null` si elle ne se déchiffre pas (autre clé maîtresse, valeur altérée). */
    public static function decrypt(string $stored, string $module, string $name): ?string
    {
        try {
            $key = self::master(false);
        } catch (Throwable) {
            return null;
        }
        if ($key === null || strlen($stored) < 4 || $stored[2] !== ':') {
            return null;
        }
        $raw = base64_decode(substr($stored, 3), true);
        $ad  = 'mar_keys:' . $module . ':' . $name;
        if ($raw === false) {
            return null;
        }

        switch (substr($stored, 0, 2)) {
            case 'x1':
                if (!function_exists('sodium_crypto_aead_xchacha20poly1305_ietf_decrypt') || strlen($raw) < 25) {
                    return null;
                }
                $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(substr($raw, 24), $ad, substr($raw, 0, 24), $key);

                return $plain === false ? null : $plain;
            case 'g1':
                if (strlen($raw) < 29) {
                    return null;
                }
                $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16), $ad);

                return $plain === false ? null : $plain;
        }

        return null;
    }

    /** Le fichier de la clé maîtresse : `MAR_KEYS_FILE`, sinon `master.key` à côté du fichier de configuration. */
    public static function masterPath(): ?string
    {
        $configured = trim((string) (Env::get('MAR_KEYS_FILE', '') ?: ''));
        if ($configured !== '') {
            return $configured;
        }
        $source = Env::source();

        return $source !== null ? dirname($source) . '/master.key' : null;
    }

    /**
     * La clé maîtresse (32 octets). Absente : `null`, ou — pour une écriture — tirée
     * au hasard et écrite (droits 0640), jamais réécrite ensuite : la changer rend
     * illisibles toutes les clés enregistrées.
     */
    private static function master(bool $create): ?string
    {
        if (self::$master !== null) {
            return self::$master;
        }
        $path = self::masterPath();
        if ($path === null) {
            if ($create) {
                throw new RuntimeException('Clé maîtresse introuvable : renseignez MAR_KEYS_FILE (un fichier hors de la racine web).');
            }

            return null;
        }

        if (is_readable($path)) {
            $content = trim((string) file_get_contents($path));
            $key = strlen($content) === 64 && ctype_xdigit($content) ? hex2bin($content) : base64_decode($content, true);
            if (!is_string($key) || strlen($key) !== 32) {
                throw new RuntimeException('Clé maîtresse illisible (' . $path . ') : 32 octets attendus, en base64 ou en hexadécimal.');
            }

            return self::$master = $key;
        }

        if (!$create) {
            return null;
        }
        if (!is_dir(dirname($path)) || !is_writable(dirname($path))) {
            throw new RuntimeException('Clé maîtresse absente et impossible à créer : ' . $path . '.');
        }
        $key = random_bytes(32);
        if (@file_put_contents($path, base64_encode($key) . "\n", LOCK_EX) === false) {
            throw new RuntimeException('Écriture de la clé maîtresse impossible : ' . $path . '.');
        }
        @chmod($path, 0640);

        return self::$master = $key;
    }

    /** @return array<string, array{ciphertext:string, hint:?string, description:?string, updated_at:string}> */
    private static function rows(string $module): array
    {
        if (isset(self::$rows[$module])) {
            return self::$rows[$module];
        }
        $rows = [];
        // Repli : l'ancienne table, tant qu'elle existe (une ligne d'erp_cles l'emporte).
        try {
            $statement = Database::connection()->prepare(
                'SELECT name, ciphertext, hint, description, updated_at FROM mar_keys WHERE module = :module ORDER BY name'
            );
            $statement->execute(['module' => $module]);
            foreach ($statement->fetchAll() as $row) {
                $rows[(string) $row['name']] = [
                    'ciphertext'  => (string) $row['ciphertext'],
                    'hint'        => $row['hint'] !== null ? (string) $row['hint'] : null,
                    'description' => $row['description'] !== null ? (string) $row['description'] : null,
                    'updated_at'  => (string) $row['updated_at'],
                ];
            }
        } catch (Throwable) {
            // Table absente : normal après la migration 046.
        }
        try {
            $prefixe = self::cle($module, '');
            $statement = Database::connection()->prepare(
                "SELECT cle, valeur, indice, integration, maj_le FROM erp_cles WHERE portail = 'mar' AND cle LIKE :p ORDER BY cle"
            );
            $statement->execute(['p' => str_replace(['_', '%'], ['\\_', '\\%'], $prefixe) . '%']);
            foreach ($statement->fetchAll() as $row) {
                $rows[substr((string) $row['cle'], strlen($prefixe))] = [
                    'ciphertext'  => (string) $row['valeur'],
                    'hint'        => $row['indice'] !== null ? (string) $row['indice'] : null,
                    'description' => $row['integration'] !== null ? (string) $row['integration'] : null,
                    'updated_at'  => (string) $row['maj_le'],
                ];
            }
        } catch (Throwable) {
            // Table absente (avant la migration 046) ou base injoignable : l'environnement prend le relais.
        }
        ksort($rows);

        return self::$rows[$module] = $rows;
    }

    /** Le nom de la ligne dans erp_cles : `mar.{module}.{nom}`. */
    public static function cle(string $module, string $name): string
    {
        return 'mar.' . $module . '.' . $name;
    }

    private static function hint(string $value): ?string
    {
        return strlen($value) >= 12 ? '••••' . substr($value, -4) : null;
    }

    private static function assertName(string $name, string $module): void
    {
        if (!in_array($module, self::MODULES, true) || preg_match('/^[A-Za-z][A-Za-z0-9_.-]{1,79}$/', $name) !== 1) {
            throw new RuntimeException('Nom de clé invalide.');
        }
    }
}
