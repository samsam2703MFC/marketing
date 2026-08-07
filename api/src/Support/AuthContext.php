<?php

declare(strict_types=1);

namespace Marketing\Support;

/**
 * Identité de l'appelant.
 *
 * Ce module **ne valide aucun jeton**. L'ERP possède déjà son middleware
 * `bearerAuth` : c'est lui qui vérifie la signature et l'expiration du JWT, puis
 * renseigne ce contexte. Dupliquer la vérification ici créerait un second chemin
 * d'authentification à maintenir — et donc une seconde occasion de se tromper.
 *
 * En l'absence de contexte, tout est refusé (fermeture par défaut) : une route
 * ne peut pas devenir publique par oubli de câblage.
 */
final class AuthContext
{
    private static ?self $current = null;

    /** @param list<int> $shopIds Boutiques du franchisé ; ignoré pour un BRAND_ADMIN */
    private function __construct(
        public readonly int $userId,
        public readonly string $role,
        public readonly ?int $brandId,
        public readonly array $shopIds,
    ) {
    }

    /**
     * Renseigne l'identité résolue par le middleware de l'ERP.
     *
     * @param list<int> $shopIds
     */
    public static function set(int $userId, string $role, ?int $brandId = null, array $shopIds = []): void
    {
        self::$current = new self($userId, $role, $brandId, array_values(array_map('intval', $shopIds)));
    }

    public static function clear(): void
    {
        self::$current = null;
    }

    public static function current(): ?self
    {
        return self::$current;
    }

    public function isBrandAdmin(): bool
    {
        return $this->role === 'BRAND_ADMIN';
    }
}
