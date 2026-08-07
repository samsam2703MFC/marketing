# API du module marketing

PHP 8.3+, PDO. Sert les tables `mar_` décrites dans [`../db/README.md`](../db/README.md).

## Statut

⚠️ **Ce module est écrit pour être repris dans la codebase de l'ERP TFBuddy, pas déployé tel quel.** Le dépôt de l'ERP n'était pas accessible au moment de l'écriture : les conventions sont donc calquées sur le swagger fourni (préfixe de route, enveloppes de réponse, `bearerAuth`), et la structure isole ce qui devra être rebranché.

Ce qui est à rebrancher sur l'ERP, et rien d'autre :

| Élément | Action |
|---|---|
| `Support/Database.php` | Appeler `Database::setConnection($pdo)` avec la connexion existante, plutôt que d'en ouvrir une seconde |
| `Support/AuthContext.php` | Le middleware JWT de l'ERP appelle `AuthContext::set($userId, $role, $brandId, $shopIds)` |
| `routes.php` | Redéclarer les routes dans le routeur de l'ERP ; les contrôleurs sont repris tels quels |
| `src/autoload.php` | Inutile : ajouter `"Marketing\\": "api/src/"` à l'autoload Composer |
| `public/index.php` | Ne pas déployer — contrôleur frontal de développement uniquement |

## Ce que le module ne fait pas

**Il ne valide aucun jeton.** L'ERP possède déjà son middleware `bearerAuth` ; le dupliquer créerait un second chemin d'authentification à maintenir, donc une seconde occasion de se tromper. En l'absence de contexte d'identité, toutes les routes répondent 401 — une route ne peut pas devenir publique par oubli de câblage.

## Périmètre de données

« Un franchisé ne voit que ses boutiques » est traité comme une règle de **sécurité**, pas d'affichage : le filtre s'applique dans le SQL (`Support/Scope.php`), jamais dans le front. Un `FRANCHISEE` qui appellerait l'API directement avec l'id d'une autre boutique obtient un 404 ou un 403, pas les données.

Une campagne est visible par un franchisé si elle est `RESEAU`, ou si l'une de ses boutiques y participe.

## Routes

Préfixe `/api/v1/marketing/` — avec une barre oblique, à ne pas confondre avec les `/api/v1/marketing-campaigns` de l'ERP, qui restent en place. Les deux familles cohabitent le temps de la bascule ; côté module, `mar_campaign` fait foi.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/references` | Tous les référentiels en un appel |
| GET | `/brands` | Marques du groupe |
| GET | `/campaigns` | Liste filtrable (`status`, `scope`, `brand_id`) |
| GET | `/campaigns/calendar?year=` | Frise annuelle, barres pré-positionnées |
| GET | `/campaigns/{id}` | Fiche complète (boutiques, leviers, rétroplanning, offre, secteurs) |
| GET | `/campaigns/{id}/monitor` | KPI et classement des boutiques |
| POST · PATCH · DELETE | `/campaigns[/{id}]` | Écriture |
| GET | `/campaigns/{id}/leads` | Leads et entonnoir |
| PATCH | `/leads/{id}/status` | Change l'état et écrit l'historique |
| GET | `/leads/{id}/history` | Historique d'un lead |
| GET | `/funds/ledger?granularity=&from=&to=` | Grand livre avec sous-totaux et solde courant |
| GET | `/funds/levers` | Synthèse par levier |
| POST | `/funds/movements` | Saisie d'un mouvement |
| GET | `/roi/quarterly` | Coût pour +1 000 € de CA, par trimestre |
| GET | `/campaigns/{id}/roi-costs` | Postes de coût |

### `/references` — le point clé

Un seul appel renvoie leviers, statuts de campagne, types, états de lead, secteurs B2B, formats, postes, canaux, accessoires et templates. **Ce sont exactement les tableaux que le prototype portait en dur**, couleurs comprises. Le front n'a plus ni palette ni liste en constante.

## Enveloppes

Identiques à celles du swagger TFBuddy, pour qu'un client existant n'ait pas à distinguer ce module du reste de l'ERP :

- erreur → `{ status: "error", description, errors? }`
- création → `{ status: "success", message, inserted_id }`
- mutation → `{ status: "success", message }`
- lecture → la donnée brute

Contrairement à plusieurs routes de l'ERP, un 204 est ici réellement vide — le swagger signale lui-même que ses 204 bavards ne doivent pas servir de contrat.

## Tests

```bash
MAR_DB_SOCKET=/tmp/mar.sock MAR_DB_NAME=marketing php api/tests/smoke.php
```

31 assertions, passées sur MariaDB 10.11. Elles couvrent les référentiels, la liste et le calendrier, le grand livre, les leads et l'historique — mais l'essentiel porte sur le périmètre : campagne locale masquée, fiche hors périmètre en 404, dépense imputée à une autre boutique refusée, lead d'une autre boutique intouchable.

Deux défauts ont été trouvés par ces tests et corrigés :

1. `:year` était lié deux fois dans la requête du calendrier — avec `EMULATE_PREPARES` désactivé, PDO refuse un paramètre nommé réutilisé.
2. `PDOException` hérite de `RuntimeException` : le routeur l'attrapait dans la branche « erreur métier » et **renvoyait le message SQL au client**, tables et colonnes comprises. Les erreurs de base partent désormais dans les logs, avec un 500 générique en réponse. Un test de non-régression garde ce comportement.
