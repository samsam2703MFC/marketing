<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Les réponses au format du standard (docs/API_STANDARD.md §6–7) : `{success, data, meta}`,
 * erreurs `{success: false, error: {code, message, details}}`, identifiant de requête.
 *
 * Réservé aux routes écrites au standard (la médiathèque) ; les routes antérieures
 * gardent leur forme tant que la bascule v2 n'est pas décidée (CLAUDE.md, §20).
 */
final class Envelope
{
    /**
     * @param mixed                $data
     * @param array<string,mixed>  $meta
     */
    public static function ok($data, array $meta = [], int $status = 200): array
    {
        return Response::data([
            'success' => true,
            'data'    => $data,
            'meta'    => ['requestId' => self::requestId()] + $meta,
        ], $status);
    }

    /** @param list<array{field:string, message:string}> $details */
    public static function error(string $code, string $message, int $status, array $details = []): array
    {
        return Response::data([
            'success' => false,
            'error'   => ['code' => $code, 'message' => $message, 'details' => $details],
            'meta'    => ['requestId' => self::requestId()],
        ], $status);
    }

    /** @return array{page:int, perPage:int, total:int, totalPages:int} */
    public static function pagination(int $page, int $perPage, int $total): array
    {
        return [
            'page'       => $page,
            'perPage'    => $perPage,
            'total'      => $total,
            'totalPages' => (int) ceil($total / max(1, $perPage)),
        ];
    }

    /** L'identifiant de requête : celui de l'appelant s'il en a posé un valable, sinon un nouveau. */
    public static function requestId(): string
    {
        $entrant = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';

        if (is_string($entrant) && preg_match('/^[A-Za-z0-9._-]{8,64}$/', $entrant) === 1) {
            return $entrant;
        }

        return sprintf('mar-%s', bin2hex(random_bytes(8)));
    }
}
