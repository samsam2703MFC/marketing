# Module marketing — L'Atelier By

Back-office marketing du réseau de franchise. PHP 8.3 + MySQL 8 côté API,
Vite 7 + React 19 + TypeScript strict côté écran. Interface en français.

- Le module vit **dans la base de l'ERP** et n'y crée que des tables préfixées
  `mar_`. Il **lit** les tables de l'ERP, il ne les crée, ne les modifie et ne
  les supprime jamais — ni en migration, ni en test, ni pour se dépanner.
- Pas de données inventées : ni jeu de démonstration, ni table imitée, ni
  fixture façonnée pour faire passer un écran. Quand une donnée manque pour
  vérifier quelque chose, on la demande.
- Les migrations vivent dans `db/migrations/`, rejouées deux fois en CI. Les
  fichiers dont le nom contient `_vues` sont **rejoués à chaque passage** : une
  vue n'a donc qu'une seule définition, et elle est dans un fichier `_vues`.
- La suite `api/tests/smoke.php` doit passer deux fois de suite sur la même
  base : un test qui laisse une trace n'est vrai qu'une fois.

## Règles API (normatives)

Toute API de ce repo suit `docs/API_STANDARD.md`. Avant d'écrire ou de modifier une route,
lis ce document et applique la checklist §19. Rappels non négociables :

1. Chemin : `{API_BASE_URL}/api/v1/{app}/{domaine}/{ressource}` — app ∈ consultant | franchise |
   erp | pwa | integration | public | admin. Ressource en kebab-case pluriel, pas de verbe.
2. `API_BASE_URL` vient TOUJOURS de la configuration (env ou /config.json). Aucune URL en dur.
   Un seul client HTTP par front, avec interceptors auth/refresh/erreurs.
3. Aucun accès direct à la base depuis un front, une PWA, un script ou un autre repo.
   Si une donnée manque, on crée l'API — on n'ouvre pas la DB.
4. Réponse : `{ "success": true, "data": ..., "meta": {...} }`. Erreur :
   `{ "success": false, "error": { "code", "message", "details": [] }, "meta": {...} }`.
   Le code HTTP fait foi. Codes d'erreur en SCREAMING_SNAKE, catalogue au §7.2.
5. Auth : JWT RS256, access 15 min en `Authorization: Bearer`, refresh opaque 30 j avec
   rotation et détection de réutilisation. `aud` du token == segment `{app}` de l'URL.
6. Autorisation par scope `{ressource}:{action}`, deny-by-default. Le tenant
   (franchiseId/shopIds) est lu DANS LE TOKEN, jamais dans le corps ou la query, et le
   filtrage est appliqué dans la couche repository.
7. Toute collection est paginée (`page`, `perPage` max 100), triable (`sort`) et filtrable
   (`filter[champ][op]`) sur liste blanche.
8. Dates ISO 8601 UTC, montants en centimes + devise, téléphones E.164, JSON camelCase,
   DB snake_case.
9. Couches : routes → controllers (HTTP only) → services (métier) → repositories (seul
   endroit avec du SQL). Validation d'entrée stricte par schéma, sérialisation de sortie explicite.
10. Médias sur Cloudflare R2 via URL présignée ; l'API renvoie une URL R2 absolue.
11. OpenAPI mis à jour avant le code + entrée dans docs/API_REGISTRY.md.
12. Tests obligatoires : 200, 401, 403, isolation tenant, 422, 404, pagination, idempotence.

Si une règle bloque la livraison, ne la contourne pas : signale l'écart et propose une
évolution du standard.

### État de ce dépôt vis-à-vis du standard

Ce module est **antérieur au standard v1.0** et n'y est pas encore conforme.
L'inventaire complet et les écarts, règle par règle, sont dans
`docs/API_REGISTRY.md`. En résumé, et parce que cela décide de ce qu'on a le
droit de faire aujourd'hui :

- Les règles de **sécurité** du standard sont tenues (fermeture par défaut,
  périmètre lu côté serveur et appliqué dans les dépôts, isolation testée) — par
  un mécanisme différent du JWT : l'identité vient du middleware de l'ERP hôte.
- Les écarts restants sont de **forme** : préfixe sans segment `{app}`, absence
  d'enveloppe `{success, data, meta}`, erreurs sans code machine, `snake_case`,
  collections non paginées.

Conséquence pratique, tirée du §20 (« ne jamais casser un endpoint en production
pour une question de style ») :

- **Une route nouvelle** se conforme au standard autant que le permet la
  cohabitation avec l'existant, et l'écart résiduel est noté au registre.
- **Une route existante** ne change ni de chemin, ni d'enveloppe, ni de casse
  sans passer par `v2` et une fenêtre de dépréciation. Le front en dépend, et
  une bascule partielle casserait des écrans sans rien améliorer.
- La bascule `v2` est un chantier à décider explicitement, pas un effet de bord
  d'une autre tâche.
