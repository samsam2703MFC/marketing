# Registre des endpoints — module marketing

Source unique des routes exposées par ce dépôt. Toute route nouvelle s'y ajoute
**avant** d'être écrite (`API_STANDARD.md` §16) ; c'est ce registre qui empêche
qu'un deuxième endpoint naisse pour la même donnée.

Établi le 17 août 2026 au titre du §20.1 du standard (inventaire préalable).

---

## 1. État de conformité, en une ligne

Ce module est **antérieur au standard v1.0** et n'y est pas conforme. Les écarts
sont réels et listés au §3 ; aucun n'est masqué. Deux choses méritent d'être
dites tout de suite, parce qu'elles décident de l'ordre des travaux :

- **Il n'y a pas d'écart de sécurité au sens du §20.2.** Le module ne fabrique
  aucune authentification : il lit l'identité posée par le middleware de l'ERP
  hôte, et refuse tout appel sans identité (`401`, fermeture par défaut, testé).
  Le périmètre boutique est appliqué dans les dépôts, jamais lu depuis le corps
  de la requête. Ce sont précisément les deux règles critiques du standard
  (§10.3), et elles sont tenues — par un autre mécanisme que le JWT.
- **Les écarts restants sont de forme** : préfixe d'URL sans segment `{app}`,
  enveloppe de réponse, casse des champs, absence de pagination. Le §20 est
  explicite : « ne jamais casser un endpoint en production pour une question de
  style ». Ils se traitent en `v2`, avec fenêtre de dépréciation.

---

## 2. Inventaire

Toutes les routes sont **authentifiées** sauf mention `@public`. Le préfixe
commun est `/api/v1/marketing/`, abrégé ci-dessous en `…`.

Colonne **Périmètre** : `tenant` = filtré sur les boutiques de l'appelant dans le
dépôt ; `marque` = réservé au rôle `BRAND_ADMIN` ; `—` = référentiel commun.

### 2.0 Vitrine — conforme au standard

Seule route écrite au format `API_STANDARD.md` : chemin `{app}/{domaine}/{ressource}`,
enveloppe `{success, data, meta}`, pagination, `camelCase`, dates ISO, montants en
centimes, code d'erreur machine. Elle n'a pas d'antériorité à ménager ; elle sert
de cible aux autres.

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `/api/v1/public/marketing/campaigns` **@public** | — | enveloppe + `data[]` paginé |

Paramètres : `page`, `perPage` (max 100, ramené), `activeOn=AAAA-MM-JJ` (défaut :
aujourd'hui). Ne rend que les campagnes qui ont demandé à paraître
(`show_web_shop`), hors brouillon, dont la période couvre le jour consulté. La
projection est explicite : ni budget, ni marge, ni objectif, ni prospect, ni
identifiant de boutique — et un test le vérifie sur la campagne sérialisée
entière, pour attraper une colonne ajoutée plus tard.

### 2.1 Session et référentiels

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/session` **@public** | — | objet — dit seulement si l'appelant est authentifié |
| GET | `…/references` | — | objet de listes (référentiels du module) |
| GET | `…/shops` | tenant | tableau |
| GET | `…/brands` | — | tableau |
| GET | `…/campaign-types` | — | objet `{types, icons}` |
| POST | `…/campaign-types` | marque | `{status, message, inserted_id}` |
| PATCH | `…/campaign-types/{id}` | marque | `{status, message}` |
| DELETE | `…/campaign-types/{id}` | marque | `{status, message}` |
| PUT | `…/campaign-types/order` | marque | objet |

### 2.2 Campagnes

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/campaigns` | tenant | tableau |
| POST | `…/campaigns` | tenant | `{status, message, inserted_id}` |
| GET | `…/campaigns/calendar` | tenant | tableau |
| GET | `…/campaigns/{id}` | tenant | objet |
| PATCH | `…/campaigns/{id}` | tenant | `{status, message}` |
| DELETE | `…/campaigns/{id}` | tenant | `{status, message}` |
| GET | `…/campaigns/{id}/draft` | tenant | objet (brouillon complet de l'assistant) |
| PUT | `…/campaigns/{id}/draft` | tenant | `{status, message}` |
| GET | `…/campaigns/{id}/monitor` | tenant | objet |
| GET | `…/campaigns/{id}/print` | tenant | objet (dossier d'impression) |
| GET | `…/campaigns/{id}/roi-costs` | tenant | tableau |
| GET | `…/campaigns/{id}/leads` | tenant | tableau |
| POST | `…/campaigns/{id}/leads/generate` | tenant | objet |
| GET | `…/campaign-offers` | tenant | tableau |
| GET | `…/offer-items` | — | tableau |

### 2.3 Fonds, royalties, redevances

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/funds/ledger` | tenant + visibilité | objet `{periods, closing_balance}` |
| POST | `…/funds/movements` | tenant | `{status, message, inserted_id}` |
| PATCH | `…/funds/movements/{id}` | tenant | `{status, message}` |
| DELETE | `…/funds/movements/{id}` | tenant | `{status, message}` |
| GET | `…/funds/recurrences` | tenant | tableau |
| POST | `…/funds/recurrences` | tenant | objet |
| DELETE | `…/funds/recurrences/{id}` | tenant | `{status, message}` |
| GET | `…/funds/royalties` | tenant | objet `{month, shops, erp}` |
| PUT | `…/funds/royalties` | tenant | objet |
| POST | `…/funds/royalties/generate` | tenant | objet (bilan d'écriture) |
| GET | `…/funds/royalties/erp` | tenant | objet (lecture ERP + diagnostic) |
| POST | `…/funds/royalties/erp/import` | tenant | objet (bilan de reprise) |
| GET | `…/funds/levers` | — | tableau |
| GET | `…/roi` | tenant | objet |
| GET | `…/roi/quarterly` | — | tableau |

### 2.4 Outils de campagne et diffusion

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/promotions` | tenant | tableau |
| GET | `…/bundles` | tenant | tableau |
| GET | `…/vouchers` | tenant | tableau |
| GET | `…/diffusion` | tenant | objet |
| GET | `…/agencies` | — | tableau |
| GET | `…/agencies/{id}/campaigns` | tenant | tableau |
| GET | `…/kits` | tenant | tableau |
| GET | `…/presence` | tenant | objet |
| POST | `…/uploads` | tenant | objet (visuel de campagne) |

### 2.5 CRM, prospection, analyse

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/crm` | tenant | objet |
| GET | `…/leads/{id}/history` | tenant | tableau |
| PATCH | `…/leads/{id}/status` | tenant | `{status, message}` |
| GET | `…/b2b/prospects` | tenant | tableau |
| GET | `…/b2b/prospects/count` | tenant | objet |
| POST | `…/b2b/prospects/import` | tenant | objet |
| GET | `…/b2b/sectors` | — | tableau |
| GET | `…/analysis` | tenant | objet |
| GET | `…/sales/quantities` | tenant | tableau |
| GET | `…/price-list` | tenant | objet |

### 2.6 Reprise ERP

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| POST | `…/erp/sync` | marque | objet (bilan de reprise) |

---

## 3. Écarts au standard, par ordre de gravité

### 3.1 Sécurité — aucun écart bloquant identifié

| Règle | État |
|---|---|
| §1.7 / §10.2 deny-by-default | **Tenu.** Sans identité, le routeur répond `401` avant d'atteindre le contrôleur. Une route ne devient pas publique par oubli. |
| §10.3 tenant lu côté serveur | **Tenu.** Le périmètre vient du contexte d'identité, jamais du corps ni de la query. Un `shop_id` envoyé par le client est vérifié contre le périmètre avant écriture. |
| §10.3 filtrage dans le dépôt | **Tenu.** `Scope::shopFilter()` compose la condition SQL dans les dépôts, pas dans les contrôleurs. |
| §18.4 test d'isolation | **Tenu.** La suite couvre « un franchisé ne voit pas / ne modifie pas ce qui n'est pas à lui » sur les campagnes, le fonds et les redevances. |
| §11.4 secrets | **Tenu.** Aucun secret en dur, `.env` non versionné, identifiants écrits hors racine web. |
| §1.1 zéro accès direct à la base | **Tenu pour le front.** Le front ne parle qu'à cette API. Côté ERP, les redevances sont passées en API ; restent sept tables lues en SQL, listées dans `API_A_CONSTRUIRE.md`. `db/migrate.php` et `db/sync-erp.php` touchent la base directement, mais ce sont des tâches serveur (migration, reprise), pas des consommateurs applicatifs. |

### 3.2 Écarts de forme — à traiter en `v2` (§20.4)

| § | Écart | Portée |
|---|---|---|
| 2.3 | Pas de segment `{app}`. Le préfixe est `/api/v1/marketing/…`, où `marketing` est un **module**, pas un contexte d'appel. Les deux consommateurs (réseau, franchisé) partagent le même préfixe et se distinguent par le rôle. | 59 routes |
| 6 | Enveloppe absente. Les lectures renvoient la donnée brute (souvent un tableau nu à la racine, interdit par §6.3), les écritures `{status, message, inserted_id}`. Pas de `meta`, pas de `requestId`. | 59 routes |
| 7 | Format d'erreur différent : `{status: "error", description, errors?}`. Pas de `code` machine-readable — le front lit le message. | toutes les erreurs |
| 3 | Champs JSON en `snake_case`, alignés sur les colonnes. Le standard impose `camelCase` avec traduction dans le mapper. | 59 routes |
| 3.1 | Montants en décimal flottant (`amount: 1600.0`), pas en unité mineure + devise. | fonds, ROI, budgets |
| 3.1 | Identifiants numériques (`id: 42`), pas des chaînes. | toutes |
| 8.1 | **Aucune collection paginée.** Les listes rendent tout. Les volumes actuels (dizaines de campagnes, quelques centaines de prospects) le supportent, mais la règle est absolue. | ~25 collections |
| 8.2/8.3 | Pas de `sort` ni de `filter[champ][op]` normalisés ; quelques filtres ad hoc (`?status=`, `?month=`). | ~25 collections |
| 9 | Pas de JWT propre : l'identité vient du middleware de l'ERP hôte, ou d'en-têtes de développement derrière `MAR_DEV_AUTH`. Pas de `/auth/*`, pas de rotation de refresh, pas de vérification d'`aud`. | module entier |
| 10.1 | Autorisation par **rôle** (`BRAND_ADMIN`, `FRANCHISEE`), pas par scope `{ressource}:{action}`. | module entier |
| 15 | Pas de couche `services/` : la règle métier vit dans les dépôts, avec le SQL. Les contrôleurs restent minces et sans SQL, mais la séparation métier/persistance n'existe pas. | module entier |
| 15 | Validation à la main dans les dépôts (exceptions métier), pas par schéma déclaratif strict. Un champ inconnu est ignoré, pas rejeté. | module entier |
| 12 | Ni `Idempotency-Key` ni `ETag`/`If-Match`. La génération des redevances et la reprise ERP sont idempotentes **par construction** (relecture de l'existant), ce qui couvre le risque financier principal sans l'en-tête. | écritures |
| 13 | Les visuels sont stockés et servis par l'application, pas sur R2 par URL présignée. | `…/uploads` |
| 16 | Pas d'OpenAPI. Ce registre est le seul contrat écrit. | module entier |
| 17 | Pas de `requestId` ni de log structuré JSON. Les erreurs SQL partent dans `error_log`. | module entier |
| 11.3 | Pas de rate limiting côté module. | module entier |

### 3.3 Ce qui n'est pas un écart mais mérite d'être noté

- `PUT …/campaign-types/order` et `POST …/funds/royalties/generate` sont des
  actions non-CRUD au sens du §4.3. `generate` est bien en `POST` avec le verbe
  en dernier segment ; `order` devrait être `POST …/campaign-types/reordonner`
  pour respecter la lettre du §4.3.
- `GET …/session` est la seule route publique, et elle est explicite dans la
  déclaration (troisième argument `true`). Elle ne rend aucune donnée métier :
  seulement si l'appelant est authentifié et sous quel rôle.

---

## 4. Trajectoire proposée

Dans l'ordre du §20, en ne cassant rien en production :

1. **Fait** — inventaire (ce document).
2. **Sans objet** — pas d'écart de sécurité à corriger en urgence (§3.1).
3. **Sans objet** — pas d'accès direct à la base depuis un consommateur applicatif.
4. **À décider** — uniformisation en `v2` : préfixe `{app}`, enveloppe, format
   d'erreur avec catalogue de codes, `camelCase`, pagination. C'est un chantier
   qui touche les 59 routes **et** le client du front. Il ne se fait pas à
   l'économie : la bascule doit être testée route par route, et `v1` reste servi
   pendant la fenêtre de dépréciation de trois mois (§14).
5. **Lié à l'écosystème** — l'authentification JWT (§9) ne peut pas être décidée
   par ce dépôt seul : l'identité vient aujourd'hui de l'ERP hôte. Soit l'ERP
   émet des tokens conformes et le module les vérifie, soit le module reste
   monté dans l'ERP et hérite de son middleware. C'est une décision d'écosystème,
   pas un choix d'implémentation local.
