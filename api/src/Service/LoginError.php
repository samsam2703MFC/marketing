<?php

declare(strict_types=1);

namespace Marketing\Service;

use RuntimeException;

/** Une connexion refusée : le message pour l'écran, le statut HTTP pour le client. */
final class LoginError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status)
    {
        parent::__construct($message);
    }
}
