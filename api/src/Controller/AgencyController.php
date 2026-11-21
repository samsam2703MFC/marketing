<?php

declare(strict_types=1);

namespace Marketing\Controller;

use Marketing\Repository\AgencyRepository;
use Marketing\Support\AuthContext;
use Marketing\Support\Envelope;
use Marketing\Support\Request;
use Marketing\Support\Response;

/**
 * Le référentiel des agences, en écriture (21/11/2026) : créer, modifier, retirer.
 *
 * Le cockpit écrivait `mar_agency` en SQL (son écran « Agences » et la note de campagne, qui signe avec l'agence de
 * la campagne ou celle par défaut) ; il passe par ces routes, avec le jeton de service. Écrites au standard autant
 * que le permet la cohabitation : enveloppe `{success, data, meta}`, camelCase, codes d'erreur du §7.2, 201 / 204.
 * Écarts notés au registre : préfixe sans segment `{app}`, retrait physique (la table n'a pas d'état « retirée »),
 * ni ETag ni en-tête `Location`. La lecture reste `GET …/agencies` (forme d'avant, snake_case).
 *
 * Réseau seul : une identité de boutique reçoit 403.
 */
final class AgencyController
{
    /** Un logo est une image embarquée : une adresse ferait un cadre vide chez le destinataire et à l'impression. */
    private const LOGO = '#^data:image/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$#';
    private const LOGO_MAX = 700000;

    public function __construct(private readonly AgencyRepository $agencies = new AgencyRepository())
    {
    }

    /** `POST …/agencies` — `{name, email?, site?, logoUri?, isDefault?}` → 201 et l'agence. */
    public function store(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        [$fields, $errors] = self::validate($request->body, true);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Agence invalide.', 422, $errors);
        }
        $auth = AuthContext::current();
        $id   = $this->agencies->create($fields, $auth !== null && $auth->userId > 0 ? $auth->userId : null);

        return Envelope::ok(self::out((array) $this->agencies->find($id)), [], 201);
    }

    /** `PATCH …/agencies/{id}` — les champs envoyés, et eux seuls → 200 et l'agence. */
    public function update(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $id = $request->intParam('id');
        if ($id === null || $this->agencies->find($id) === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Agence introuvable.', 404);
        }
        [$fields, $errors] = self::validate($request->body, false);
        if ($errors !== []) {
            return Envelope::error('VALIDATION_FAILED', 'Agence invalide.', 422, $errors);
        }
        $this->agencies->update($id, $fields);

        return Envelope::ok(self::out((array) $this->agencies->find($id)));
    }

    /** `DELETE …/agencies/{id}` — 204 ; 404 inconnue ; 409 si un canal de campagne ou une intervention la désigne. */
    public function destroy(Request $request): array
    {
        if (($denied = self::deny()) !== null) {
            return $denied;
        }
        $id = $request->intParam('id');
        if ($id === null || $this->agencies->find($id) === null) {
            return Envelope::error('RESOURCE_NOT_FOUND', 'Agence introuvable.', 404);
        }
        $usage = $this->agencies->usage($id);
        if ($usage['channels'] > 0 || $usage['interventions'] > 0) {
            $details = [];
            if ($usage['channels'] > 0) {
                $details[] = ['field' => 'channels', 'message' => $usage['channels'] . ' canal(aux) de campagne la désignent.'];
            }
            if ($usage['interventions'] > 0) {
                $details[] = ['field' => 'interventions', 'message' => $usage['interventions'] . ' intervention(s) enregistrée(s).'];
            }

            return Envelope::error('RESOURCE_STATE_INVALID', sprintf(
                '%s la désignent : elle ne peut pas être retirée, les campagnes passées perdraient qui les a faites.',
                implode(' et ', array_filter([
                    $usage['channels'] > 0 ? $usage['channels'] . ' canal(aux) de campagne' : null,
                    $usage['interventions'] > 0 ? $usage['interventions'] . ' intervention(s)' : null,
                ]))
            ), 409, $details);
        }
        $this->agencies->delete($id);

        return Response::data(null, 204);
    }

    /**
     * @param  array<string,mixed> $body
     * @return array{0:array<string,mixed>, 1:list<array{field:string, message:string}>}
     */
    private static function validate(array $body, bool $creating): array
    {
        $fields = [];
        $errors = [];
        foreach (array_keys($body) as $key) {
            if (!array_key_exists((string) $key, AgencyRepository::WRITABLE)) {
                $errors[] = ['field' => (string) $key, 'message' => 'Champ inconnu.'];
            }
        }
        if (array_key_exists('name', $body) || $creating) {
            $name = is_string($body['name'] ?? null) ? trim($body['name']) : null;
            if ($name === null || $name === '') {
                $errors[] = ['field' => 'name', 'message' => 'Le nom de l’agence est obligatoire.'];
            } elseif (mb_strlen($name) > 160) {
                $errors[] = ['field' => 'name', 'message' => '160 caractères au plus.'];
            } else {
                $fields['name'] = $name;
            }
        }
        if (array_key_exists('email', $body)) {
            $email = $body['email'] === null ? '' : (is_string($body['email']) ? trim($body['email']) : false);
            if ($email === false || ($email !== '' && (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 190))) {
                $errors[] = ['field' => 'email', 'message' => 'Une adresse e-mail valable, ou rien.'];
            } else {
                $fields['email'] = $email === '' ? null : $email;
            }
        }
        if (array_key_exists('site', $body)) {
            $site = $body['site'] === null ? '' : (is_string($body['site']) ? trim($body['site']) : false);
            if ($site === false || mb_strlen($site) > 190) {
                $errors[] = ['field' => 'site', 'message' => 'Texte de 190 caractères au plus, ou rien.'];
            } else {
                $fields['site'] = $site === '' ? null : $site;
            }
        }
        if (array_key_exists('logoUri', $body)) {
            $logo = $body['logoUri'] === null ? '' : (is_string($body['logoUri']) ? $body['logoUri'] : false);
            if ($logo === false || ($logo !== '' && (preg_match(self::LOGO, $logo) !== 1 || strlen($logo) > self::LOGO_MAX))) {
                $errors[] = ['field' => 'logoUri', 'message' => 'Une image embarquée (data:image/…;base64,…) de 700 000 caractères au plus, ou rien.'];
            } else {
                $fields['logoUri'] = $logo === '' ? null : $logo;
            }
        }
        if (array_key_exists('isDefault', $body)) {
            if (!is_bool($body['isDefault'])) {
                $errors[] = ['field' => 'isDefault', 'message' => 'Valeur attendue : true ou false.'];
            } else {
                $fields['isDefault'] = $body['isDefault'];
            }
        }

        return [$fields, $errors];
    }

    /** @param array<string,mixed> $row */
    private static function out(array $row): array
    {
        return [
            'id'        => (int) ($row['id'] ?? 0),
            'name'      => (string) ($row['name'] ?? ''),
            'email'     => $row['email'] ?? null,
            'site'      => $row['site'] ?? null,
            'logoUri'   => $row['logo_uri'] ?? null,
            'isDefault' => (bool) ($row['is_default'] ?? false),
            'campaigns' => (int) ($row['channel_campaigns'] ?? 0),
        ];
    }

    private static function deny(): ?array
    {
        $auth = AuthContext::current();

        return $auth !== null && $auth->isBrandAdmin()
            ? null
            : Envelope::error('PERM_ROLE_REQUIRED', 'Les agences du réseau se gèrent depuis le pilotage réseau.', 403);
    }
}
