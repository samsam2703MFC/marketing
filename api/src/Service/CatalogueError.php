<?php

declare(strict_types=1);

namespace Marketing\Service;

use RuntimeException;

/**
 * Un refus du service des catalogues, avec son code du catalogue §7.2 (ou un code métier
 * `CATALOGUE_…`), son statut HTTP et le détail par champ. Le contrôleur le met en enveloppe.
 */
final class CatalogueError extends RuntimeException
{
    /** @param list<array{field:string, message:string}> $details */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
