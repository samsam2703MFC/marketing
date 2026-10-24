<?php

declare(strict_types=1);

namespace Marketing\Service;

use RuntimeException;

/**
 * Refus métier d'une opération sur les bons, avec le statut HTTP qui le dit.
 *
 * Une RuntimeException suffirait au routeur (il en fait un 422) ; ici, les
 * refus ne se valent pas : une campagne introuvable (404), un périmètre
 * dépassé (403), un code déjà pris (409), une connexion non configurée (503).
 */
final class VoucherError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
