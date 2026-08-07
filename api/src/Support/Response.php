<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Enveloppes de réponse.
 *
 * Les formes reprennent exactement celles du swagger TFBuddy, pour que les
 * clients existants n'aient pas à distinguer ce module du reste de l'ERP :
 *   • erreur    → { status: "error",   description, errors? }
 *   • création  → { status: "success", message, inserted_id }
 *   • mutation  → { status: "success", message }
 *   • lecture   → la donnée brute
 */
final class Response
{
    /** @param mixed $data */
    public static function data($data, int $status = 200): array
    {
        return ['status' => $status, 'body' => $data];
    }

    public static function created(string $message, int|string $insertedId): array
    {
        return self::data([
            'status'      => 'success',
            'message'     => $message,
            'inserted_id' => $insertedId,
        ], 201);
    }

    public static function mutated(string $message): array
    {
        return self::data(['status' => 'success', 'message' => $message]);
    }

    /** @param mixed $errors */
    public static function error(string $description, int $status = 400, $errors = null): array
    {
        $body = ['status' => 'error', 'description' => $description];
        if ($errors !== null) {
            $body['errors'] = $errors;
        }

        return self::data($body, $status);
    }

    public static function notFound(string $description = 'Ressource introuvable.'): array
    {
        return self::error($description, 404);
    }

    public static function forbidden(string $description = 'Périmètre non autorisé.'): array
    {
        return self::error($description, 403);
    }

    public static function unauthorized(string $description = 'Authentification requise.'): array
    {
        return self::error($description, 401);
    }

    /**
     * Écrit la réponse. Un corps `null` produit un 204 réellement vide —
     * le swagger signale que plusieurs routes de l'ERP émettent un corps sur un
     * 204 et que les clients ne doivent pas s'y fier ; ce module ne le fait pas.
     */
    public static function emit(array $response): void
    {
        http_response_code($response['status']);

        if ($response['body'] === null) {
            return;
        }

        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(
            $response['body'],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        );
    }
}
