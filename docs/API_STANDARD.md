# STANDARD API — Écosystème Franchise Buddy / L'Atelier By

**Document normatif. Version 1.0 — août 2026.**

À copier tel quel dans **chaque repo** de l'écosystème (backend, front, PWA, connecteurs) sous `docs/API_STANDARD.md`, et à référencer depuis `CLAUDE.md`.

> Ce document n'est pas une suggestion. Toute API qui ne respecte pas ces règles est un écart à corriger, pas un choix d'implémentation.

---

## 0. Comment Claude Code doit utiliser ce document

Avant d'écrire ou de modifier **la moindre** route :

1. Lire ce document en entier.
2. Vérifier si la ressource existe déjà ailleurs dans l'écosystème (`grep` sur les routes) — **on n'invente pas un deuxième endpoint pour la même donnée**.
3. Écrire d'abord le contrat (chemin, méthode, DTO d'entrée, DTO de sortie, codes d'erreur), puis le code.
4. À la fin, dérouler la **checklist §19**. Un point non coché = PR bloquée.

Si une règle de ce document empêche de livrer, **ne pas contourner** : signaler l'écart et proposer une évolution du standard.

---

## 1. Les 8 règles non négociables

1. **Zéro accès direct à la base.** Aucun front, PWA, script, cron, connecteur ou autre repo ne parle à la base de données. Toute donnée transite par une API HTTP. Pas d'exception « juste pour ce petit script ».
2. **Le serveur est une variable.** Aucune URL d'API n'est écrite en dur, nulle part. Un seul point de configuration par application (§11.1).
3. **Un seul client HTTP par application front.** Interceptors auth, refresh, erreurs, `X-Request-Id` centralisés. Aucun `fetch()` / `axios()` brut dans un composant.
4. **Toutes les APIs se ressemblent.** Même préfixe, même enveloppe de réponse, même format d'erreur, même pagination, même auth — quel que soit le module.
5. **Auth par JWT access + refresh**, sur toutes les applications, sans variante locale (§9).
6. **Le tenant vient du token, jamais du client.** Le `franchiseId` / `shopId` envoyé par le front ne donne jamais un droit (§10.3).
7. **Rien n'est public par défaut.** Une route est authentifiée sauf déclaration explicite `@public` documentée.
8. **Pas de SQL hors de la couche repository** (§15).

---

## 2. Anatomie d'une URL

```
https://{API_BASE_URL}/api/{version}/{app}/{domaine}/{ressource}[/{id}[/{sous-ressource}]]
```

Exemple de référence (existant, conforme) :

```
POST https://atelierby.tfbuddy.com/api/v1/consultant/auth/login
      └────────── variable ──────────┘└─┬─┘└──┬───┘└─┬─┘└─┬──┘
                                      base version app  domaine+action
```

### 2.1 `{API_BASE_URL}`

Host + éventuel sous-chemin. **Toujours injecté par configuration** (§11.1). Jamais concaténé à la main dans le code métier.

### 2.2 `{version}`

`v1`, `v2`… Toujours présent, même pour une nouvelle API. Voir §14.

### 2.3 `{app}` — segment d'application (obligatoire)

Il identifie le **contexte d'appel et le périmètre d'authentification**. Valeurs autorisées :

| Segment | Consommateur | Auth |
|---|---|---|
| `consultant` | Panel consultant / réseau | JWT utilisateur consultant |
| `franchise` | Console franchisé | JWT utilisateur franchisé |
| `erp` | Back-office franchiseur (erp.atelierby.be) | JWT utilisateur ERP |
| `pwa` | Apps clients (Café, Fidélité) | JWT client final ou anonyme |
| `integration` | Connecteurs machine-to-machine (POS, signage, scripts) | Clé API / client_credentials |
| `public` | Endpoints réellement publics (santé, catalogue vitrine) | Aucune |
| `admin` | Administration plateforme | JWT + rôle `platform_admin` |

Une même ressource métier peut exister sous deux apps avec des projections différentes (`/consultant/shops` ≠ `/franchise/shops`). **C'est voulu** : la projection et les droits diffèrent. Le code métier sous-jacent, lui, est mutualisé (§15).

### 2.4 `{domaine}` et `{ressource}`

- Domaine = module fonctionnel : `auth`, `referentiels`, `production`, `kitchen`, `recrutement`, `signage`, `achats`, `media`, `signature`.
- Ressource = **nom commun, pluriel, kebab-case** : `shops`, `report-shares`, `review-guidelines`, `recuissons`.
- **Jamais de verbe dans l'URL** — sauf actions non-CRUD (§4.3).

✅ `/api/v1/consultant/referentiels/kpis`
❌ `/api/v1/getKpiList`, `/api/v1/consultant/Kpi`, `/api/v1/consultant/kpi/get-all`

### 2.5 Profondeur

Deux niveaux de ressource maximum. Au-delà, on repart de la racine avec un filtre.

✅ `/api/v1/franchise/shops/42/recuissons`
✅ `/api/v1/franchise/recuissons?filter[shopId]=42&filter[date]=2026-08-17`
❌ `/api/v1/franchise/shops/42/recuissons/7/produits/3/lots`

---

## 3. Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Segment d'URL | `kebab-case`, pluriel | `review-guidelines` |
| Champ JSON (in & out) | `camelCase` | `shopId`, `createdAt` |
| Paramètre de query | `camelCase` | `?perPage=25` |
| Colonne / table SQL | `snake_case` | `ws_review_guidelines` |
| Code d'erreur | `SCREAMING_SNAKE_CASE` | `AUTH_INVALID_CREDENTIALS` |
| En-tête custom | `X-Pascal-Kebab` | `X-Request-Id` |
| Enum | `SCREAMING_SNAKE_CASE` en valeur | `"status": "PENDING_REVIEW"` |

La traduction `snake_case` (DB) → `camelCase` (JSON) se fait dans la couche repository/mapper. **Jamais de nom de colonne brut exposé dans une réponse.**

### 3.1 Types de données

- **Dates** : ISO 8601 UTC avec `Z` → `"2026-08-17T14:30:00Z"`. Jamais de timestamp Unix, jamais de date locale sans fuseau.
- **Date seule** : `"2026-08-17"`.
- **Montants** : entier en **unité mineure** + devise séparée → `{"amountCents": 12550, "currency": "EUR"}`. Jamais de float.
- **Identifiants** : chaîne (`"id": "42"` ou UUID). Le front ne fait jamais d'arithmétique dessus.
- **Booléens** : `isActive`, `hasStock` — pas de `0`/`1`, pas de `"true"`.
- **Champ absent vs null** : `null` = valeur connue et vide. Champ absent = non demandé (sparse fields). On n'utilise pas `""` ou `0` comme « vide ».
- **Téléphone** : format **E.164** obligatoire → `"+48662149896"`.

---

## 4. Verbes et codes HTTP

### 4.1 Verbes

| Verbe | Usage | Idempotent |
|---|---|---|
| `GET` | Lecture. **Jamais d'effet de bord.** | Oui |
| `POST` | Création, ou action non-CRUD | Non |
| `PATCH` | Mise à jour **partielle** (défaut) | Oui |
| `PUT` | Remplacement complet (rare) | Oui |
| `DELETE` | Suppression (logique par défaut) | Oui |

`PATCH` est la norme. `PUT` seulement si le client envoie réellement la ressource entière.

### 4.2 Codes de réponse

| Code | Quand |
|---|---|
| `200` | OK avec corps |
| `201` | Créé — + en-tête `Location` de la ressource |
| `202` | Accepté, traitement asynchrone (retourne un `jobId`) |
| `204` | OK sans corps (DELETE) |
| `400` | Requête malformée (JSON invalide, param illisible) |
| `401` | Pas de token / token invalide ou expiré |
| `403` | Authentifié mais pas le droit (rôle, scope, tenant) |
| `404` | Ressource inexistante **ou** hors du tenant si l'existence est confidentielle |
| `409` | Conflit d'état (doublon, transition interdite) |
| `410` | Endpoint déprécié et supprimé |
| `412` | `If-Match` non satisfait (concurrence) |
| `422` | Requête bien formée mais **validation métier/champ** en échec |
| `429` | Rate limit dépassé |
| `500` | Erreur serveur non gérée — **jamais de détail technique dans le corps** |
| `503` | Dépendance indisponible (DB, R2, POS) |

Règle : **400 = je n'ai pas compris. 422 = j'ai compris, c'est refusé.**

### 4.3 Actions non-CRUD

Quand l'opération n'est pas une manipulation de ressource, on utilise un sous-chemin verbe explicite en `POST` :

```
POST /api/v1/franchise/recuissons/{id}/valider
POST /api/v1/consultant/candidats/{id}/appel
POST /api/v1/erp/contrats/{id}/envoyer-signature
```

Le verbe est le **dernier** segment, à l'infinitif, et l'action est toujours en `POST`.

---

## 5. Format de requête

```http
POST /api/v1/consultant/auth/login HTTP/1.1
Host: atelierby.tfbuddy.com
Content-Type: application/json
Accept: application/json
Accept-Language: fr-BE
X-Request-Id: 018f7c2a-...
X-App-Version: consultant-web@2.14.0

{
  "phone": "+48662149896",
  "password": "123"
}
```

Règles :

- `Content-Type: application/json` obligatoire sur tout corps. Pas de `form-urlencoded`, pas de `multipart` sauf upload (§13).
- Corps en **objet racine**, jamais un tableau nu.
- Le client génère un `X-Request-Id` (UUID v4) par requête ; le serveur le renvoie tel quel et le loggue.
- **Aucun secret en query string.** Jamais de token, mot de passe ou clé API dans l'URL.
- Encodage UTF-8. Toujours.

---

## 6. Format de réponse — succès

**Enveloppe unique, sur 100 % des réponses.**

### 6.1 Ressource unique

```json
{
  "success": true,
  "data": {
    "id": "42",
    "name": "Halle",
    "createdAt": "2026-08-17T14:30:00Z"
  },
  "meta": { "requestId": "018f7c2a-..." }
}
```

### 6.2 Collection

```json
{
  "success": true,
  "data": [ { "id": "42" }, { "id": "43" } ],
  "meta": {
    "requestId": "018f7c2a-...",
    "pagination": {
      "page": 1,
      "perPage": 25,
      "total": 137,
      "totalPages": 6
    }
  }
}
```

### 6.3 Interdits

- ❌ Retourner un tableau nu à la racine.
- ❌ Enveloppes différentes selon le module (`{data}` ici, `{result}` là, `{items}` ailleurs).
- ❌ Un `200` avec `{"success": false}` dedans. **Le code HTTP fait foi.**
- ❌ Renvoyer des champs internes : `password_hash`, `deleted_at`, ids techniques de jointure.

---

## 7. Format d'erreur

**Une seule forme, partout :**

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Numéro de téléphone ou mot de passe incorrect.",
    "details": []
  },
  "meta": { "requestId": "018f7c2a-..." }
}
```

Erreur de validation (`422`) :

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Certains champs sont invalides.",
    "details": [
      { "field": "phone", "rule": "e164", "message": "Le numéro doit être au format international." },
      { "field": "password", "rule": "minLength", "message": "8 caractères minimum." }
    ]
  },
  "meta": { "requestId": "018f7c2a-..." }
}
```

### 7.1 Règles

- `code` est **stable et machine-readable**. Le front teste le `code`, jamais le `message`.
- `message` est destiné à l'humain, dans la langue de `Accept-Language`, **sans détail technique** (pas de nom de table, pas de stack, pas de requête SQL).
- `details` est toujours un tableau (vide si non applicable), jamais `null`.
- Une `500` ne fuit rien : `{"code": "INTERNAL_ERROR", "message": "Une erreur est survenue."}` + `requestId` pour retrouver la trace côté serveur.

### 7.2 Catalogue de codes (préfixe = domaine)

| Code | HTTP |
|---|---|
| `VALIDATION_FAILED` | 422 |
| `MALFORMED_REQUEST` | 400 |
| `AUTH_INVALID_CREDENTIALS` | 401 |
| `AUTH_TOKEN_MISSING` | 401 |
| `AUTH_TOKEN_EXPIRED` | 401 |
| `AUTH_TOKEN_INVALID` | 401 |
| `AUTH_REFRESH_REUSED` | 401 |
| `AUTH_ACCOUNT_LOCKED` | 403 |
| `AUTH_ACCOUNT_INACTIVE` | 403 |
| `PERM_ROLE_REQUIRED` | 403 |
| `PERM_SCOPE_REQUIRED` | 403 |
| `PERM_TENANT_MISMATCH` | 403 / 404 |
| `RESOURCE_NOT_FOUND` | 404 |
| `RESOURCE_CONFLICT` | 409 |
| `RESOURCE_STATE_INVALID` | 409 |
| `PRECONDITION_FAILED` | 412 |
| `RATE_LIMIT_EXCEEDED` | 429 |
| `INTERNAL_ERROR` | 500 |
| `DEPENDENCY_UNAVAILABLE` | 503 |

Codes métier : `{MODULE}_{RAISON}` → `RECUISSON_BATCH_BELOW_MINIMUM`, `POS_SYNC_ALREADY_RUNNING`, `SIGNATURE_DOCUMENT_ALREADY_SIGNED`.

### 7.3 Sécurité des messages

Login échoué : **même code, même message, même temps de réponse** que le compte existe ou non. On n'énumère pas les comptes.

---

## 8. Collections : pagination, tri, filtres, recherche

### 8.1 Pagination — obligatoire sur toute collection

```
GET /api/v1/consultant/shops?page=1&perPage=25
```

- Défaut `perPage=25`, maximum `100`. Une valeur supérieure est ramenée à 100 (pas une erreur).
- `total` et `totalPages` toujours renvoyés dans `meta.pagination`.
- **Aucun endpoint ne retourne « tout » sans pagination.** Pas d'exception pour les référentiels : ils paginent aussi, avec `perPage=100`.
- Listes très volumineuses ou temps réel → pagination par curseur : `?cursor=...&limit=50`, `meta.pagination.nextCursor`.

### 8.2 Tri

```
?sort=-createdAt,name
```

`-` = décroissant. Seuls les champs explicitement autorisés par endpoint sont triables (liste blanche) — sinon `422 VALIDATION_FAILED`.

### 8.3 Filtres

```
?filter[status]=ACTIVE
?filter[shopId]=42
?filter[createdAt][gte]=2026-08-01&filter[createdAt][lt]=2026-09-01
?filter[status][in]=ACTIVE,PENDING
```

Opérateurs autorisés : `eq` (défaut), `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`, `null`.

Liste blanche de champs filtrables par endpoint. Tout champ inconnu → `422`.

### 8.4 Recherche plein texte

```
?q=halle
```

Un seul paramètre, la logique de recherche est côté serveur.

### 8.5 Champs et relations

```
?fields=id,name,status          → projection réduite
?include=owner,shop             → relations imbriquées (liste blanche, profondeur 1)
```

Pas d'`include` par défaut : on ne renvoie jamais un graphe complet « au cas où ».

---

## 9. Authentification — JWT access + refresh

### 9.1 Endpoints (identiques pour chaque `{app}`)

| Méthode | Chemin | Rôle |
|---|---|---|
| `POST` | `/api/v1/{app}/auth/login` | Identifiants → couple de tokens |
| `POST` | `/api/v1/{app}/auth/refresh` | Refresh token → nouveau couple (rotation) |
| `POST` | `/api/v1/{app}/auth/logout` | Révoque le refresh token courant |
| `POST` | `/api/v1/{app}/auth/logout-all` | Révoque toutes les sessions de l'utilisateur |
| `GET` | `/api/v1/{app}/auth/me` | Profil + rôles + scopes + tenant |
| `POST` | `/api/v1/{app}/auth/password/forgot` | Envoi du lien/OTP |
| `POST` | `/api/v1/{app}/auth/password/reset` | Réinitialisation par token |
| `POST` | `/api/v1/{app}/auth/password/change` | Changement (authentifié) |
| `POST` | `/api/v1/{app}/auth/otp/request` | OTP SMS (si activé) |
| `POST` | `/api/v1/{app}/auth/otp/verify` | Vérification OTP |

### 9.2 Login — contrat

```http
POST /api/v1/consultant/auth/login
Content-Type: application/json

{ "phone": "+48662149896", "password": "123" }
```

```json
{
  "success": true,
  "data": {
    "tokenType": "Bearer",
    "accessToken": "eyJhbGciOi...",
    "expiresIn": 900,
    "refreshToken": "rt_9f3a...",
    "refreshExpiresIn": 2592000,
    "user": {
      "id": "17",
      "displayName": "Sam Verheyden",
      "phone": "+48662149896",
      "email": "sam@example.com",
      "app": "consultant",
      "roles": ["CONSULTANT"],
      "scopes": ["shops:read", "reports:read"],
      "tenant": { "franchiseId": "1", "shopIds": ["3", "7", "12"] },
      "locale": "fr-BE"
    }
  },
  "meta": { "requestId": "..." }
}
```

**Identifiant de connexion** : `phone` au format E.164 (standard TFB). Si un module utilise l'email, le champ est `email` — **jamais un champ générique `login`/`username`** qui change de sens selon l'app.

### 9.3 Access token

- JWT signé **RS256** (clé asymétrique — les services vérifient sans détenir le secret de signature).
- Durée : **15 minutes** (`900`).
- Transmis **uniquement** en en-tête : `Authorization: Bearer <accessToken>`.
- Claims obligatoires :

```json
{
  "iss": "https://atelierby.tfbuddy.com",
  "aud": "consultant",
  "sub": "17",
  "jti": "018f7c...",
  "iat": 1755439800,
  "exp": 1755440700,
  "app": "consultant",
  "roles": ["CONSULTANT"],
  "scopes": ["shops:read", "reports:read"],
  "tenant": { "franchiseId": "1", "shopIds": ["3", "7", "12"] }
}
```

- **`aud` doit correspondre au segment `{app}` de l'URL.** Un token `pwa` appelant `/api/v1/erp/...` → `401 AUTH_TOKEN_INVALID`. C'est la barrière principale entre applications.
- Aucune donnée sensible dans le payload (le JWT est lisible par n'importe qui).

### 9.4 Refresh token

- Opaque (pas un JWT), stocké **haché** en base, lié à un device/session.
- Durée : **30 jours**, glissante.
- **Rotation obligatoire** : chaque `/auth/refresh` invalide l'ancien et en émet un nouveau.
- **Détection de réutilisation** : si un refresh token déjà consommé est représenté → révocation de **toute la famille de sessions** de l'utilisateur + `401 AUTH_REFRESH_REUSED` + log de sécurité.
- Stockage côté client : cookie `HttpOnly; Secure; SameSite=Strict` quand le front est same-site ; sinon stockage sécurisé natif. **Jamais en `localStorage` pour le refresh.**

### 9.5 Comportement client (imposé)

1. Requête → `401` avec `code: AUTH_TOKEN_EXPIRED`.
2. L'interceptor appelle `/auth/refresh` **une seule fois**, en file d'attente (les requêtes concurrentes attendent le même refresh, pas N refresh parallèles).
3. Succès → rejoue la requête d'origine. Échec → purge des tokens + redirection login.
4. Un `401` avec un autre code que `AUTH_TOKEN_EXPIRED` → **pas de retry**, déconnexion directe.

### 9.6 Machine-to-machine (`/integration`)

- Soit `Authorization: Bearer <token>` obtenu via `POST /api/v1/integration/auth/token` (`grant_type=client_credentials`, `clientId` + `clientSecret`).
- Soit en-tête `X-Api-Key: <clé>` pour les intégrations simples (connecteurs POS, boîtiers signage).
- Chaque clé est **nominative** (un consommateur = une clé), **scopée**, **rotative**, **révocable**, et son usage est loggué.
- Jamais de clé API dans un front ou une PWA : le secret ne survit pas au navigateur.

---

## 10. Autorisation

### 10.1 Rôles vs scopes

- **Rôle** = qui est l'utilisateur (`PLATFORM_ADMIN`, `FRANCHISEUR`, `CONSULTANT`, `FRANCHISE_OWNER`, `SHOP_MANAGER`, `PRODUCTION`, `CUSTOMER`).
- **Scope** = ce qu'il peut faire, format `{ressource}:{action}` → `recuissons:write`, `kpis:read`, `contrats:sign`.
- Les endpoints se protègent **par scope**, pas par rôle. Les rôles ne servent qu'à composer des jeux de scopes.

### 10.2 Déclaration

Chaque route déclare explicitement son exigence, à côté de sa définition :

```
GET  /api/v1/franchise/recuissons        → scope: recuissons:read
POST /api/v1/franchise/recuissons/{id}/valider → scope: recuissons:write
```

Une route sans déclaration = **refusée par défaut** (deny-by-default), pas ouverte.

### 10.3 Isolation multi-tenant — règle critique

Le périmètre (`franchiseId`, `shopIds`) est **lu dans le token**, jamais dans le corps ou la query.

- Si le client envoie `shopId`, le serveur **vérifie** qu'il appartient au périmètre du token ; sinon `403 PERM_TENANT_MISMATCH`.
- Toute requête de lecture est **automatiquement filtrée** sur le tenant, au niveau du repository. Pas au niveau du controller, pas « en pensant à le faire ».
- Un `GET /shops/{id}` hors périmètre renvoie `404 RESOURCE_NOT_FOUND` (on ne confirme pas l'existence).
- Test obligatoire par ressource : **utilisateur A ne voit pas la donnée de B**.

### 10.4 Sur-couche : le franchiseur

Un utilisateur franchiseur/consultant peut avoir un périmètre multi-boutiques. Il n'y a **pas de by-pass** : son token porte simplement une liste `shopIds` plus large, ou un scope `tenant:all` explicite et audité.

---

## 11. Configuration, sécurité, transport

### 11.1 Base URL en variable — obligatoire

Un et un seul point d'entrée de configuration par application :

```
# .env
API_BASE_URL=https://atelierby.tfbuddy.com
```

```
VITE_API_BASE_URL=...      (Vite)
NEXT_PUBLIC_API_BASE_URL=... (Next)
```

Pour les PWA / apps déployées une fois et pointant plusieurs environnements : **configuration runtime**, pas build-time — un `GET /config.json` servi à côté de l'app, lu au démarrage.

Un seul module l'expose :

```ts
// src/lib/api/config.ts
export const API_BASE_URL = requireEnv('VITE_API_BASE_URL'); // throw si absent
export const apiUrl = (path: string) => `${API_BASE_URL}/api/v1${path}`;
```

Interdits : `http://localhost:3000` en dur, URL de prod commitée, `if (isDev) baseUrl = ...` dispersé dans le code.

### 11.2 Transport

- **HTTPS uniquement.** HTTP → `301` vers HTTPS, ou refus.
- HSTS activé.
- CORS : **liste blanche d'origines explicite** par app. Jamais `Access-Control-Allow-Origin: *` sur une route authentifiée.
- En-têtes de réponse : `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (hors pages d'embed signage), `Referrer-Policy: no-referrer`.

### 11.3 Rate limiting

Obligatoire, avec en-têtes standard :

```
RateLimit-Limit: 60
RateLimit-Remaining: 41
RateLimit-Reset: 30
Retry-After: 30      (sur 429)
```

Seuils minimaux :

- `/auth/login`, `/auth/otp/*`, `/auth/password/forgot` : **5 tentatives / 15 min par identifiant + par IP**, puis backoff progressif et `AUTH_ACCOUNT_LOCKED` au-delà.
- API authentifiée standard : 600 req/min par utilisateur.
- `/integration` : quota par clé.

### 11.4 Mots de passe et secrets

- Hachage **argon2id** (ou bcrypt cost ≥ 12). Jamais de MD5/SHA nu.
- Longueur minimale 8, vérification contre les mots de passe compromis courants.
- Aucun secret en dur dans le code, aucun `.env` commité. Rotation documentée.
- Les logs ne contiennent **jamais** : mot de passe, token, refresh token, clé API, corps complet d'une requête d'auth.

### 11.5 Tailles et délais

- Corps de requête : 1 Mo max (hors upload).
- Timeout serveur : 30 s. Au-delà → traitement asynchrone `202` + `jobId`.
- Compression `gzip`/`br` activée.

---

## 12. Idempotence et concurrence

### 12.1 Idempotency-Key

Obligatoire sur tout `POST` à effet financier ou irréversible (paiement, redevance, commande fournisseur, envoi de signature, envoi SMS/e-mail) :

```
Idempotency-Key: 018f7c2a-...
```

Le serveur stocke la réponse 24 h et **rejoue la même réponse** pour la même clé, au lieu de recréer.

### 12.2 Concurrence optimiste

Sur les ressources éditées à plusieurs (référentiels, checklists, planogrammes) :

- La réponse `GET` porte un `ETag`.
- Le `PATCH` envoie `If-Match: <etag>`.
- ETag obsolète → `412 PRECONDITION_FAILED`. Pas de dernier-arrivé-écrase-tout silencieux.

### 12.3 Traitements longs

```
POST /api/v1/erp/imports/pos       → 202 { "jobId": "job_123", "status": "QUEUED" }
GET  /api/v1/erp/jobs/job_123      → { "status": "RUNNING", "progress": 0.42 }
```

---

## 13. Fichiers et médias

**Les médias sont sur Cloudflare R2. C'est le media server de référence.**

Règles :

1. Aucun binaire en base, aucun fichier servi par l'application applicative.
2. Upload en deux temps :

   ```
   POST /api/v1/{app}/media/upload-url
   → { "uploadUrl": "https://...r2...", "objectKey": "shops/42/planogramme.png", "expiresIn": 900 }
   ```

   Le client `PUT` directement sur R2, puis confirme :

   ```
   POST /api/v1/{app}/media  { "objectKey": "...", "type": "PLANOGRAMME", "shopId": "42" }
   ```

3. Toute réponse d'API référençant un média renvoie une **URL R2 absolue** dans un champ `url` (+ `thumbnailUrl` si applicable). Jamais un chemin relatif à recomposer côté front.
4. Médias privés → URL signée avec expiration, champ `expiresAt` renvoyé.
5. Contrôles à l'upload : type MIME en liste blanche, taille max par type, nom d'objet généré côté serveur (jamais le nom de fichier utilisateur).

---

## 14. Versionnement et dépréciation

- `v1` figé : **on n'y introduit que des changements additifs** (nouveau champ optionnel, nouvel endpoint). Jamais de renommage, de suppression de champ, de changement de type ou de resserrement de validation.
- Changement cassant → `v2`, les deux versions cohabitent.
- Dépréciation :

  ```
  Deprecation: true
  Sunset: Wed, 31 Dec 2026 23:59:59 GMT
  Link: </api/v2/consultant/kpis>; rel="successor-version"
  ```

  Minimum **3 mois** entre annonce et suppression. Après suppression : `410`.
- Le front ne « devine » jamais une version : elle est dans l'URL.

---

## 15. Structure de code imposée

```
routes/          → déclaration du chemin, méthode, middleware auth/scope, schéma
controllers/     → HTTP uniquement : parse, appel service, mapping réponse. ZÉRO métier.
services/        → règles métier, transactions, orchestration. ZÉRO SQL, ZÉRO objet HTTP.
repositories/    → seul endroit qui touche la base. Filtrage tenant appliqué ici.
schemas/ (DTO)   → validation entrée + sérialisation sortie
mappers/         → snake_case DB ↔ camelCase API
errors/          → classes d'erreur → codes du catalogue §7.2
```

Règles :

- Un controller ne dépasse pas ~40 lignes par action. S'il grossit, c'est du métier mal placé.
- Un service ne connaît ni `req` ni `res`.
- **Aucune requête SQL / ORM hors `repositories/`.**
- Une même règle métier n'est écrite qu'une fois, quelle que soit l'app qui l'appelle : `/consultant/shops` et `/franchise/shops` partagent le service, pas le copier-coller.
- Validation d'entrée **systématique** par schéma déclaratif (zod, class-validator, FormRequest, JSON Schema — selon le stack), à l'entrée, avant tout traitement. Champ inconnu → rejeté (`strict`), pas ignoré silencieusement.
- Sérialisation de sortie **explicite** : on liste les champs renvoyés. Jamais `return row` ni `return entity`.

---

## 16. Documentation

- **Spec-first** : le contrat OpenAPI 3.1 est écrit ou mis à jour **avant** le code.
- Exposée sur `GET /api/v1/openapi.json` et une UI sur `/api/v1/docs` (protégée hors prod publique).
- Chaque endpoint documente : description, auth requise, scope, paramètres, schéma d'entrée, schéma de sortie, **tous** les codes d'erreur possibles, un exemple `curl` complet.
- La CI échoue si le code diverge du contrat.
- Toute nouvelle API est ajoutée au **registre central des endpoints** du repo (`docs/API_REGISTRY.md`) — c'est la source qui empêche les doublons.

---

## 17. Observabilité et audit

- **Log structuré JSON** par requête : `requestId`, `userId`, `app`, `method`, `path`, `status`, `durationMs`, `tenant`. Jamais de secret, jamais de PII inutile.
- `requestId` propagé jusqu'aux appels sortants (POS, R2, Stripe).
- **Journal d'audit** sur toute écriture sensible (droits, contrats, prix, redevances, référentiels) : qui, quoi, avant/après, quand, depuis quelle IP. Immuable.
- Endpoints techniques : `GET /api/v1/public/health` (liveness) et `/api/v1/public/ready` (dépendances DB/R2/POS).
- Alerte sur : taux de `5xx`, pic de `401`/`403`, latence p95, `AUTH_REFRESH_REUSED`.

---

## 18. Tests obligatoires par endpoint

Un endpoint sans ces tests n'est pas livrable :

1. **200/201** — cas nominal, schéma de réponse validé contre l'OpenAPI.
2. **401** — sans token, et avec token expiré.
3. **403** — token valide, scope manquant.
4. **Isolation tenant** — utilisateur A ne peut pas lire/écrire la donnée de B (le test le plus important).
5. **422** — validation en échec, `details` correctement rempli.
6. **404** — id inexistant.
7. **Pagination** — page 2, `perPage` au-delà du max, `total` cohérent.
8. **Idempotence** — pour les `POST` concernés, double appel avec la même clé = un seul effet.

---

## 19. Checklist de conformité (à cocher avant merge)

```
[ ] URL : /api/v1/{app}/{domaine}/{ressource}, kebab-case, pluriel, pas de verbe (hors action §4.3)
[ ] Aucune URL d'API en dur — tout passe par la config centralisée
[ ] Aucun accès direct à la base depuis un front/script/autre repo
[ ] Verbe HTTP correct, code de retour correct (§4.2)
[ ] Enveloppe { success, data, meta } respectée
[ ] Erreurs au format §7 avec un code du catalogue §7.2
[ ] Auth déclarée : public explicite OU scope requis explicite
[ ] aud du token == segment {app} de l'URL
[ ] Filtrage tenant appliqué dans le repository, testé
[ ] Validation d'entrée par schéma strict, champs inconnus rejetés
[ ] Sérialisation de sortie explicite, aucun champ interne exposé
[ ] Collection paginée, triable et filtrable par liste blanche
[ ] Dates ISO 8601 UTC, montants en unité mineure, téléphones E.164
[ ] Rate limit en place (renforcé sur /auth/*)
[ ] Idempotency-Key si effet irréversible ; ETag/If-Match si édition concurrente
[ ] Médias : URL R2 absolue, upload par URL présignée
[ ] OpenAPI mis à jour + entrée dans docs/API_REGISTRY.md
[ ] Log structuré avec requestId ; audit si écriture sensible
[ ] Les 8 tests du §18 passent
[ ] Aucun changement cassant sur v1
```

---

## 20. Mise en conformité de l'existant

Ordre de traitement, du plus rentable au moins urgent :

1. **Inventaire** : lister tous les endpoints existants (chemin, méthode, auth, forme de réponse) dans `docs/API_REGISTRY.md`.
2. **Écarts de sécurité d'abord** : routes sans auth, absence de filtrage tenant, secrets en query, tokens longue durée. Correction immédiate, même si cassant.
3. **Accès directs à la base** : lister les fronts/scripts/PWA qui lisent la DB, créer l'API manquante, couper l'accès.
4. **Uniformisation non cassante** : ajouter l'enveloppe et le format d'erreur en `v2` de l'endpoint, faire migrer les clients, retirer `v1` après la fenêtre de dépréciation.
5. **Cosmétique en dernier** : renommages de champs, casse, pluriels — uniquement via `v2`.

Ne jamais casser un endpoint en production pour une question de style. La sécurité, oui.

---

## 21. Bloc à coller dans le `CLAUDE.md` de chaque repo

```md
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
```
