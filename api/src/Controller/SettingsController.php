<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Support\AuthContext;
use Marketing\Support\Config;
use Marketing\Support\Envelope;
use Marketing\Support\Env;
use Marketing\Support\Keys;
use Marketing\Support\Request;
use Marketing\Support\Settings;
use RuntimeException;

/**
 * Les réglages (`…/variables`) et les secrets (`…/keys`) du module, en base.
 *
 * Écrit au standard (enveloppe, camelCase, codes du catalogue). Réservé au réseau.
 * Une clé ne se relit jamais : l'écran reçoit son nom, ses quatre derniers
 * caractères, sa date, et d'où elle vient (base, fichier du serveur, absente).
 */
final class SettingsController
{
    private const VALUE_MAX = 2000;

    /** `GET …/variables` : le catalogue, chaque réglage avec sa valeur effective et sa source. */
    public function variables(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        $stored = Config::all();
        $names  = array_unique(array_merge(array_keys(Settings::VARIABLES), array_keys($stored)));
        $rows   = [];
        foreach ($names as $name) {
            $meta   = Settings::VARIABLES[$name] ?? ['group' => 'Autres', 'label' => $name, 'help' => ''];
            $inBase = isset($stored[$name]);
            $env    = Env::get($name);
            $rows[] = [
                'name'      => $name,
                'group'     => $meta['group'],
                'label'     => $meta['label'],
                'help'      => $meta['help'],
                'value'     => $inBase ? $stored[$name]['value'] : ($env !== null && $env !== '' ? $env : null),
                'source'    => $inBase ? 'base' : ($env !== null && $env !== '' ? 'fichier' : 'absente'),
                'updatedAt' => $inBase ? self::iso($stored[$name]['updated_at']) : null,
            ];
        }

        return Envelope::ok($rows, ['bootstrap' => Config::BOOTSTRAP]);
    }

    /** `PUT …/variables/{name}` `{ value }` : pose un réglage en base (il l'emporte sur le fichier). */
    public function putVariable(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $name = (string) $request->param('name');
        $errors = self::unknownFields($request->body, ['value']);
        $value = $request->body['value'] ?? null;
        if (!array_key_exists('value', $request->body)) {
            $errors[] = ['field' => 'value', 'message' => 'Valeur attendue.'];
        } elseif (!is_scalar($value) || mb_strlen((string) $value) > self::VALUE_MAX) {
            $errors[] = ['field' => 'value', 'message' => 'Texte ou nombre de ' . self::VALUE_MAX . ' caractères au plus.'];
        }
        if (isset(Settings::KEYS[$name])) {
            $errors[] = ['field' => 'name', 'message' => $name . ' est un secret : il s\'enregistre parmi les clés.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Réglage refusé.', 422, $errors);
        }

        try {
            Config::put($name, is_string($value) ? trim($value) : $value, 'marketing', AuthContext::current()?->userId);
        } catch (RuntimeException $failure) {
            return Envelope::error('VALIDATION_FAILED', $failure->getMessage(), 422, [['field' => 'name', 'message' => $failure->getMessage()]]);
        }

        return $this->variables($request);
    }

    /** `DELETE …/variables/{name}` : retire le réglage de la base (le fichier, ou le défaut, reprend). */
    public function deleteVariable(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        Config::delete((string) $request->param('name'));

        return $this->variables($request);
    }

    /** `GET …/keys` : les clés connues, sans leur valeur. */
    public function keys(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }

        return Envelope::ok($this->describeKeys(), [
            'masterKey' => ['present' => Keys::available(), 'path' => Keys::masterPath() !== null ? basename((string) Keys::masterPath()) : null],
        ]);
    }

    /** `PUT …/keys/{name}` `{ value }` : enregistre une clé, chiffrée. La réponse ne la contient pas. */
    public function putKey(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $name   = (string) $request->param('name');
        $errors = self::unknownFields($request->body, ['value']);
        $value  = $request->body['value'] ?? null;
        if (!is_string($value) || trim($value) === '' || strlen($value) > 4000) {
            $errors[] = ['field' => 'value', 'message' => 'Texte non vide de 4 000 caractères au plus.'];
        }
        if ((Settings::KEYS[$name]['deploy'] ?? false) === true) {
            $errors[] = ['field' => 'name', 'message' => $name . ' est tiré et entretenu par le déploiement (Social et le cockpit en reçoivent la même valeur) : il ne se change pas ici.'];
        }
        if (isset(Settings::VARIABLES[$name])) {
            $errors[] = ['field' => 'name', 'message' => $name . ' n\'est pas un secret : il s\'enregistre parmi les variables.'];
        }
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Clé refusée.', 422, $errors);
        }

        try {
            Keys::put($name, trim((string) $value), 'marketing', AuthContext::current()?->userId);
        } catch (RuntimeException $failure) {
            return Envelope::error('VALIDATION_FAILED', $failure->getMessage(), 422, [['field' => 'value', 'message' => $failure->getMessage()]]);
        }

        return $this->keys($request);
    }

    /** `DELETE …/keys/{name}` : retire la clé de la base. */
    public function deleteKey(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $name = (string) $request->param('name');
        if ((Settings::KEYS[$name]['deploy'] ?? false) === true) {
            return Envelope::error('VALIDATION_FAILED', $name . ' est entretenu par le déploiement : il ne se retire pas ici.', 422, [['field' => 'name', 'message' => 'Clé du déploiement.']]);
        }
        Keys::delete($name);

        return $this->keys($request);
    }

    /** @return list<array<string,mixed>> */
    private function describeKeys(): array
    {
        $stored = [];
        foreach (Keys::describe() as $row) {
            $stored[$row['name']] = $row;
        }
        $rows = [];
        foreach (array_unique(array_merge(array_keys(Settings::KEYS), array_keys($stored))) as $name) {
            $meta   = Settings::KEYS[$name] ?? ['group' => 'Autres', 'label' => $name, 'help' => '', 'deploy' => false];
            $inBase = isset($stored[$name]);
            $env    = Env::get($name);
            $rows[] = [
                'name'      => $name,
                'group'     => $meta['group'],
                'label'     => $meta['label'],
                'help'      => $meta['help'],
                'managedByDeploy' => $meta['deploy'],
                'source'    => $inBase ? 'base' : ($env !== null && $env !== '' ? 'fichier' : 'absente'),
                'hint'      => $inBase ? $stored[$name]['hint'] : null,
                'readable'  => $inBase ? $stored[$name]['readable'] : null,
                'updatedAt' => $inBase ? self::iso($stored[$name]['updated_at']) : null,
            ];
        }

        return $rows;
    }

    private static function deny(): ?array
    {
        $auth = AuthContext::current();

        return $auth !== null && $auth->isBrandAdmin()
            ? null
            : Envelope::error('PERM_ROLE_REQUIRED', 'Les réglages du module sont réservés au réseau.', 403);
    }

    /** @return list<array{field:string, message:string}> */
    private static function unknownFields(array $body, array $allowed): array
    {
        $errors = [];
        foreach (array_keys($body) as $key) {
            if (!in_array($key, $allowed, true)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }

        return $errors;
    }

    private static function iso(string $value): string
    {
        return (new \DateTimeImmutable($value))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }
}
