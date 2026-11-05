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
| GET | `…/session` **@public** | — | objet — dit seulement si l'appelant est authentifié, et par quelle voie (`via`) |
| POST | `…/session` **@public** | — | `{ phone, password }` → connexion par les identifiants de l'ERP ; pose le cookie de session signé |
| DELETE | `…/session` **@public** | — | ferme la session (efface le cookie) ; sans session, ne fait rien |
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
| PUT | `…/campaigns/{id}/lever-targets` | tenant (écriture : marque, ou boutique sur sa campagne locale) | `{status, message}` — objectifs par levier seuls, tout statut ; idempotent |
| POST | `…/campaigns/{id}/offer-items` | tenant (même règle d'écriture) | `{status, message}` — produits du catalogue ajoutés à l'offre, tout statut ; ajout seul, idempotent |
| GET | `…/campaigns/{id}/monitor` | tenant | objet |
| GET | `…/campaigns/{id}/print` | tenant | objet (dossier d'impression) |
| GET | `…/campaigns/{id}/brochures` | tenant | tableau `[{format, settings, updated_at}]` — réglages du générateur de brochures, un par format |
| PUT | `…/campaigns/{id}/brochures/{format}` | tenant (écriture : marque, ou boutique sur sa campagne locale) | `{status, message}` — `format` ∈ `leaflet-a5`, `depliant-a4` ; remplace les réglages du format, idempotent |
| GET | `…/campaigns/{id}/roi-costs` | marque | tableau |
| GET | `…/campaigns/{id}/vouchers` | tenant (résultats limités aux boutiques de l'appelant) | objet `{configured, message, can_edit, vouchers, totals, campaign_promotions}` — anciens bons du webshop, **lecture seule** depuis le 05/11/2026 (§7) ; `can_edit` toujours faux |
| GET | `…/campaigns/{id}/erp-vouchers` | tenant | enveloppe — `data {campaignId, configured, message, canEdit, vouchers[], lines[]}` — bons de TFBuddy (§13) |
| POST | `…/campaigns/{id}/erp-vouchers` | tenant (écriture : marque, ou boutique sur sa campagne locale) | enveloppe, `201` — le bon créé dans TFBuddy, relu |
| PATCH | `…/campaigns/{id}/erp-vouchers/{voucherId}` | même règle d'écriture | enveloppe — `{status: ACTIVE \| INACTIVE}`, idempotent |
| GET | `…/campaigns/{id}/leads` | tenant | tableau |
| POST | `…/campaigns/{id}/leads/generate` | tenant | objet |
| GET | `…/campaign-offers` | tenant | tableau |
| GET | `…/offer-items` | — | tableau |

### 2.3 Fonds et ROI

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/funds/ledger` | tenant + visibilité | objet `{periods, closing_balance}` |
| POST | `…/funds/movements` | tenant | `{status, message, inserted_id}` |
| PATCH | `…/funds/movements/{id}` | tenant | `{status, message}` |
| DELETE | `…/funds/movements/{id}` | tenant | `{status, message}` |
| GET | `…/funds/recurrences` | tenant | tableau |
| POST | `…/funds/recurrences` | tenant | objet |
| DELETE | `…/funds/recurrences/{id}` | tenant | `{status, message}` |
| GET | `…/funds/levers` | marque | tableau |
| GET | `…/roi` | marque | objet |
| GET | `…/roi/quarterly` | marque | tableau |

### 2.4 Outils de campagne et diffusion

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/promotions` | tenant | tableau |
| GET | `…/bundles` | tenant | tableau |
| GET | `…/vouchers` | tenant | tableau |
| GET | `…/erp-promotions?family=&page=&perPage=` | tenant (franchisé : réseau + ses boutiques) | enveloppe + `data[]` paginé — §8 |
| GET | `…/diffusion` | tenant | objet |
| GET | `…/agencies` | — | tableau |
| GET | `…/agencies/{id}/campaigns` | tenant | tableau |
| GET | `…/kits` | tenant | tableau |
| GET | `…/presence` | tenant | objet |
| POST | `…/uploads` | tenant | objet (visuel de campagne) |
| GET | `…/shop-supports?page=&perPage=&filter[shop][eq]=&filter[kind][eq]=` | réseau ; boutique : les siennes | enveloppe + `data[]` paginé — §11 |
| PUT | `…/shop-supports/{shopId}` | réseau | enveloppe — `{ supports: [...] }` remplace la liste de la boutique, idempotent — §11 |
| GET | `…/media-library` | marque (Social : jeton de service) | enveloppe — catégories, saisons, limites de dépôt — §9 |
| GET | `…/media-assets?page=&perPage=&sort=&filter[…]` | marque | enveloppe + `data[]` paginé — §9 |
| POST | `…/media-assets` | marque | enveloppe — `201` créé, `200` + `meta.duplicate` si le fichier y était déjà |
| GET | `…/media-assets/{id}` | marque | enveloppe |
| PATCH | `…/media-assets/{id}` | marque | enveloppe — nom, classements, `archived` |
| PUT | `…/media-assets/{id}/thumbnail` | marque | enveloppe — couverture d'une vidéo |
| DELETE | `…/media-assets/{id}` | marque | enveloppe — retrait idempotent, le fichier reste servi |

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
| GET | `…/analysis` | marque | objet |
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
| §18.4 test d'isolation | **Tenu.** La suite couvre « un franchisé ne voit pas / ne modifie pas ce qui n'est pas à lui » sur les campagnes et le fonds. |
| §11.4 secrets | **Tenu.** Aucun secret en dur, `.env` non versionné, identifiants écrits hors racine web. |
| §1.1 zéro accès direct à la base | **Tenu pour le front.** Le front ne parle qu'à cette API. Côté ERP, six tables restent lues en SQL, listées dans `API_A_CONSTRUIRE.md`. `db/migrate.php` et `db/sync-erp.php` touchent la base directement, mais ce sont des tâches serveur (migration, reprise), pas des consommateurs applicatifs. |

### 3.2 Écarts de forme — à traiter en `v2` (§20.4)

| § | Écart | Portée |
|---|---|---|
| 2.3 | Pas de segment `{app}`. Le préfixe est `/api/v1/marketing/…`, où `marketing` est un **module**, pas un contexte d'appel. Les deux consommateurs (réseau, franchisé) partagent le même préfixe et se distinguent par le rôle. | 55 routes (dont `…/erp-promotions`, au format du standard pour le reste, §8) |
| 6 | Enveloppe absente. Les lectures renvoient la donnée brute (souvent un tableau nu à la racine, interdit par §6.3), les écritures `{status, message, inserted_id}`. Pas de `meta`, pas de `requestId`. | 54 routes |
| 7 | Format d'erreur différent : `{status: "error", description, errors?}`. Pas de `code` machine-readable — le front lit le message. | toutes les erreurs |
| 3 | Champs JSON en `snake_case`, alignés sur les colonnes. Le standard impose `camelCase` avec traduction dans le mapper. | 54 routes |
| 3.1 | Montants en décimal flottant (`amount: 1600.0`), pas en unité mineure + devise. | fonds, ROI, budgets |
| 3.1 | Identifiants numériques (`id: 42`), pas des chaînes. | toutes |
| 8.1 | **Aucune collection paginée.** Les listes rendent tout. Les volumes actuels (dizaines de campagnes, quelques centaines de prospects) le supportent, mais la règle est absolue. | ~25 collections |
| 8.2/8.3 | Pas de `sort` ni de `filter[champ][op]` normalisés ; quelques filtres ad hoc (`?status=`, `?month=`). | ~25 collections |
| 9 | Pas de JWT propre : l'identité vient d'une connexion par les identifiants de l'ERP (cookie `HttpOnly` signé HMAC, 12 h, sans refresh), d'un jeton de service pour les autres modules du serveur (`X-Marketing-Service`), ou — en développement seulement — d'en-têtes derrière `MAR_DEV_AUTH`. Pas de `/auth/*`, pas de rotation de refresh, pas de vérification d'`aud`. | module entier |
| 10.1 | Autorisation par **rôle** (`BRAND_ADMIN`, `FRANCHISEE`), pas par scope `{ressource}:{action}`. | module entier |
| 15 | Pas de couche `services/` : la règle métier vit dans les dépôts, avec le SQL. Les contrôleurs restent minces et sans SQL, mais la séparation métier/persistance n'existe pas. | module entier |
| 15 | Validation à la main dans les dépôts (exceptions métier), pas par schéma déclaratif strict. Un champ inconnu est ignoré, pas rejeté. | module entier |
| 12 | Ni `Idempotency-Key` ni `ETag`/`If-Match`. La reprise ERP est idempotente **par construction** (relecture de l’existant). | écritures |
| 13 | Les visuels sont stockés et servis par l'application, pas sur R2 par URL présignée. | `…/uploads` |
| 16 | Pas d'OpenAPI. Ce registre est le seul contrat écrit. | module entier |
| 17 | Pas de `requestId` ni de log structuré JSON. Les erreurs SQL partent dans `error_log`. | module entier |
| 11.3 | Pas de rate limiting côté module. | module entier |

### 3.3 Ce qui n'est pas un écart mais mérite d'être noté

- `PUT …/campaign-types/order` est une
  actions non-CRUD au sens du §4.3. `generate` est bien en `POST` avec le verbe
  en dernier segment ; `order` devrait être `POST …/campaign-types/reordonner`
  pour respecter la lettre du §4.3.
- `GET`, `POST` et `DELETE …/session` sont les seules routes publiques, et
  c'est explicite dans la déclaration (dernier argument `true`). Aucune ne rend
  de donnée métier. `GET` dit si l'appelant est authentifié, sous quel rôle, et
  par quelle voie : `via` = `erp` (connexion), `service` (autre module) ou `dev`
  (`MAR_DEV_AUTH`), plus `dev_auth` et `login_ready` (adresse de l'ERP et
  secret de session présents) — des états, aucune valeur ; champs ajoutés,
  rien de retiré ni renommé.

**Connexion** (`POST …/session`, octobre 2026). Le module sert au pilotage de
la marque : il s'ouvre avec un **compte réseau** de l'ERP, et avec lui
seulement. Il ne garde aucun mot de passe : il présente téléphone et mot de
passe au réalm `admin` de l'ERP (`MAR_ERP_AUTH_BASE`). Accepté → `BRAND_ADMIN`.
Refusé faute d'appartenance réseau (403, ou 409) → 403 : un compte de boutique
n'a pas accès au module, le réalm `owner` n'est pas essayé. Mot de passe faux :
401. Le cookie `mar_session` (`HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS)
porte l'identité, signé par `MAR_SESSION_SECRET` : réécrit, il ne vaut rien, et
un cookie qui ne serait pas réseau n'ouvre rien, même signé. Le jeton de l'ERP
n'est pas gardé. Écarts au §5 : pas de JWT RS256 propre ni de refresh à
rotation — une session de 12 heures, puis une nouvelle connexion.

**Accès de service.** Le module Social et le cockpit appellent cette API de
serveur à serveur. Ils présentent `X-Marketing-Service`, comparé en temps
constant à `MAR_SERVICE_TOKEN` ; ils agissent au niveau du réseau. Un jeton
faux ne retombe sur aucune autre identité. Le jeton est tiré sur le serveur au
premier déploiement et posé dans `service-token`, à côté du `.env`, lisible par
`www-data` ; il ne passe pas par GitHub.

---

## 4. Trajectoire proposée

Dans l'ordre du §20, en ne cassant rien en production :

1. **Fait** — inventaire (ce document).
2. **Sans objet** — pas d'écart de sécurité à corriger en urgence (§3.1).
3. **Sans objet** — pas d'accès direct à la base depuis un consommateur applicatif.
4. **À décider** — uniformisation en `v2` : préfixe `{app}`, enveloppe, format
   d'erreur avec catalogue de codes, `camelCase`, pagination. C'est un chantier
   qui touche les 54 routes **et** le client du front. Il ne se fait pas à
   l'économie : la bascule doit être testée route par route, et `v1` reste servi
   pendant la fenêtre de dépréciation de trois mois (§14).
5. **Lié à l'écosystème** — l'authentification JWT (§9) ne peut pas être décidée
   par ce dépôt seul : l'identité vient aujourd'hui de l'ERP hôte. Soit l'ERP
   émet des tokens conformes et le module les vérifie, soit le module reste
   monté dans l'ERP et hérite de son middleware. C'est une décision d'écosystème,
   pas un choix d'implémentation local.

---

## 5. Le retrait des redevances

La gestion des redevances a été retirée le 17 août 2026 — écran, routes, dépôts
et tests —, la base étant alors laissée en l'état : un `DROP` est irréversible et
n'avait pas à être pris dans le même mouvement qu'un retrait de fonctionnalité.
Le retrait ayant été redemandé, la **migration 034** s'en charge.

Elle ne détruit aucune donnée saisie. Chaque suppression est conditionnée à
l'absence de contenu ; là où quelque chose a réellement été enregistré, l'objet
reste, inerte et invisible, et son sort se décide en le regardant.

| Objet | Sort en 034 |
|---|---|
| `mar_royalty_rate` (+ sa colonne `kind`) | supprimée **si vide** |
| `mar_fund_movement.base_amount`, `.rate_pct` | supprimées **si aucune écriture n'en porte** |
| `mar_fund_source` : `ROYALTY_MARKETING`, `ROYALTY_ASSISTANCE`, `ROYALTY_MARQUE` | supprimées **si aucune écriture ne les référence** |
| index `ix_mar_fm_redevance` | **renommé** `ix_mar_fm_source` — MySQL s'en sert pour porter la clé étrangère vers `mar_fund_source`, et le supprimer laisserait cette clé sans index |

Sur une base où les redevances n'ont jamais tourné, les trois premières lignes
partent entièrement. Sur une base qui en porte, tout reste : une écriture de
redevance est une ligne comptable, et « 1 240,50 € » sans sa base ni son taux ne
se recalcule pas.

Ce qui n'est **pas** concerné, et pourquoi :

- **`mar_fund_source.ROYALTY`** (« Royalties ») date de la migration 005, bien
  avant la fonctionnalité retirée. C'est la ligne de recette du fonds marketing —
  ce que le réseau verse —, pas un reste de l'outil. Elle reste donc proposée à
  la saisie d'un mouvement.
- **`mar_shop_revenue`** porte le CA déclaré par boutique et par mois. Son
  commentaire d'origine la disait « assiette des royalties », mais elle est lue
  aujourd'hui par la synthèse par levier, pour la pénétration sur le CA réseau.
  Elle est en service.
- **`mar_fund_movement.is_public`** règle la visibilité d'une écriture. C'est une
  décision propre au fonds, prise dans le formulaire de saisie, et sans rapport
  avec les redevances.

Côté écran, l'entrée de menu « Fonds & Royalties » devient **« Fonds marketing »** :
le fonds est ce que l'écran gère, les royalties n'en sont qu'une origine de
recette parmi cinq.

---

## 6. L'assistant de campagne regroupé ici (octobre 2026)

L'assistant avait deux copies : celle-ci et celle du BO (`consultant_BO`,
`tools/assistant-src` et `public/api/marketing`), qui avait évolué de son côté.
Tout est désormais ici ; la page de l'assistant du BO renvoie vers le Marketing
(`/marketing/?campagne={id}&assistant=1`). **Aucune route nouvelle** : les routes
existantes acceptent quelques champs de plus, ce qui ne casse aucun client (§20).

| Route | Ce qui s'ajoute | D'où |
|---|---|---|
| `POST …/campaigns`, `PUT …/campaigns/{id}/draft`, `PATCH …/campaigns/{id}` | `b2b_offices_only` (booléen) ; `channels[].is_enabled` (canal retenu ≠ validé ; absent = validé) | assistant du BO, migration 035 |
| idem | `tracking_action_id`, `tracking_scope` (`SHOP` \| `NETWORK`), `tracking_target` (≥ 0), `tracking_baseline` (`N1` \| `AVANT`) — le **suivi** de la campagne ; valeurs inconnues → `422` | migration 036 |
| `GET …/campaigns/{id}` | `tracking_action_code`, `tracking_action_label`, `tracking_unit_label`, `tracking_source_label`, `tracking_cockpit_measure` | migration 036 |
| `GET …/campaigns/{id}/draft` | `b2b_offices_only`, `channels[].is_enabled`, les quatre champs du suivi | — |
| `GET …/references` | `trackingActions` : `{id, code, label, unit_label, source_label, cockpit_measure}` | migration 036 |
| `GET …/b2b/prospects`, `…/b2b/prospects/count` | `?offices_only=1` ; le compte rend `offices` (`null` tant que le vivier ne le sait pas) | assistant du BO |
| `POST …/campaigns` | un brouillon identique (même marque, nom et dates) n'est pas recréé : son identifiant est rendu | assistant du BO |
| `PATCH …/campaigns/{id}` | `color_primary_hex`, `color_secondary_hex`, `color_accent_hex`, `color_ink_hex` : l'assistant enregistre une campagne **lancée** en `PATCH`, colonnes seules (il ne réécrit plus ses rattachements) | assistant « hub » |

Écart résiduel, inchangé : `snake_case`, pas d'enveloppe `{success, data, meta}`
(module antérieur au standard, bascule en `v2` à décider).

**Routes du cockpit appelées par l'assistant.** Le KPI du levier et la référence
du suivi (`GET /api/cockpit/marketing/kpi-periode`) ainsi que les documents
joints (`/api/cockpit/marketing/campagne/{id}/annexes`, `…/annexe/{id}`) sont
servis par le cockpit du BO, pas par ce module : ils lisent la caisse et le
disque du BO. Leur racine vient de la configuration (`VITE_COCKPIT_BASE`,
`/consulant_bo` sur le serveur ; variable `COCKPIT_PATH` du déploiement).

**Module Social appelé par l'assistant.** La colonne « Rattaché » et les étapes
« Canaux » et « Récap » lisent `GET {VITE_SOCIAL_BASE}api/v1/social/operations/bo-{id}/rattache`
(module Social & Ads, `/marketing/social/` sur le serveur) : posts, publications et
publicités Meta rattachés, et l'adresse du webshop des liens suivis. Lecture seule.

**Routes lues par le Calendrier marketing** (vue Réseau seule, lecture seule) :

| Route | Ce que la frise en tire |
|---|---|
| `GET /api/v1/marketing/campaigns` | les campagnes et leurs dates (ce module) |
| `GET {VITE_SOCIAL_BASE}api/v1/social/state` | les posts du module Social (hors brouillons) et les publicités Meta qu'il suit |
| `GET {VITE_SOCIAL_BASE}api/v1/social/meta/calendriers?du=&au=` | les publications des Pages et comptes Instagram hors module (100 jours au plus ; relues chez Meta, une dizaine de secondes) |
| `GET {VITE_SOCIAL_BASE}api/v1/social/google` | les avis Google et la note du réseau face à la cible |
| `GET {VITE_COCKPIT_BASE}/api/cockpit/marketing/hub` | les newsletters et SMS du cockpit (`emailing.liste`, sans les modèles `exemple` ni les brouillons) |

`GET /api/v1/marketing/campaigns/calendar` n'est plus lu par le front : la frise
place les campagnes elle-même, au jour près.

**Compléter une campagne** (`PUT …/lever-targets`, `POST …/offer-items`, octobre 2026).
Une campagne lancée ne se réécrit plus en bloc (`PUT …/draft` est réservé aux
brouillons, `PATCH` ne porte que ses colonnes) : ses objectifs par levier — ce
que le Retour sur opération du module Social lit comme objectif — ne se
complétaient donc plus. Cette route ne touche qu'eux. Corps
`{ "lever_targets": [{ "lever_id", "target_value" }] }` ; un montant vide ou nul
détache le levier (ou vide seulement sa cible s'il porte déjà un réalisé), les
leviers non envoyés ne bougent pas. Levier inconnu, montant négatif ou corps
illisible : 422, rien d'écrit.

`POST …/campaigns/{id}/offer-items` (`{ "offer_item_ids": [462] }`) ajoute des
produits du catalogue à l'offre : le Retour sur opération compte les ventes de
ces produits, et sans eux ne mesure rien. **Ajout seul** — réécrire l'offre
d'une campagne lancée effacerait en cascade ses objectifs par boutique et par
produit et ses bundles. Un produit déjà présent n'est pas rajouté ; une
campagne sans offre en reçoit une, à son nom. Produit inconnu ou liste vide :
422, rien d'écrit. Écart résiduel des deux routes, comme le reste du module :
pas d'enveloppe `{success, data, meta}`, `snake_case`.

**Brochures d'une campagne** (`GET …/brochures`, `PUT …/brochures/{format}`, octobre 2026).
Le générateur de brochures (Campagnes › Brochures & leaflets) compose un leaflet
A5 recto-verso ou un dépliant A4 trois volets à partir du dossier d'impression
(`GET …/print`) : offre, produits, prix, conditions et palette ne sont pas
recopiés. Ces deux routes ne portent que ce qui appartient à la brochure : le
modèle, les textes en français et en néerlandais, le choix et l'ordre des
produits, un prix saisi quand le catalogue n'en a pas de fiable, la destination
du QR code et les boutiques écartées. Corps du `PUT` :
`{ "settings": { template, texts: {fr, nl}, products: [{key, on, price}], qr: {mode, category, group}, excludedShops: [n], cropMarks } }`.
Validation stricte : clé inconnue, modèle hors liste, texte de plus de 240
caractères, prix négatif ou QR « catégorie » sans catégorie refusent l'envoi
entier (422, rien d'écrit). Table `mar_campaign_brochure` (migration 038), une
ligne par campagne et par format. Écart résiduel, comme le reste du module :
pas d'enveloppe `{success, data, meta}`, erreurs sans code machine ; les clés
des réglages sont en `camelCase` parce que le document est rendu tel quel au
front.

Le générateur lit aussi, sans rien y écrire :

| Route | Ce que le générateur en tire |
|---|---|
| `GET {VITE_SOCIAL_BASE}api/v1/social/state` | les boutiques (adresse, horaires, téléphone, langues) et l'adresse du webshop |
| `GET {VITE_SOCIAL_BASE}api/v1/social/catalogue/nav?shop=N` | les catégories du webshop de la boutique, pour diriger le QR code |

Le QR code de chaque version mène au webshop **de la boutique** :
`{webshopUrl}?shop=N`, suivi de la catégorie choisie le cas échéant — le même
lien que les posts du module Social.

**Routes lues par le Tableau de bord, bloc « Trafic clients et panier moyen »**
(vue Réseau seule, lecture seule) :

| Route | Ce que le bloc en tire |
|---|---|
| `GET /api/v1/marketing/shops` | les boutiques du périmètre (ce module) ; `erp-N` donne le numéro `N` au panel |
| `GET {VITE_COCKPIT_BASE}/api/cockpit/stores/perf?annees=` | CA, tickets et panier moyen par magasin et par mois (P&L mensuel du panel, la lecture du levier Trafic du cockpit ; 10 à 30 secondes) |
| `GET /api/v1/marketing/funds/ledger?granularity=month` | les sorties du fonds marketing, en repère pour le coût par client (ce module) |

La route du cockpit rend **tous** les magasins du panel : le bloc n'est donc pas
servi en vue franchisé, où il faudrait filtrer dans le navigateur. L'ouvrir aux
franchisés demande une route de ce module, filtrée par périmètre côté serveur.

## 7. Les bons de campagne (octobre 2026)

> **Remplacé le 05/11/2026 par le §13** : les bons se créent dans TFBuddy et
> valent en caisse comme au webshop. Les routes d'écriture décrites ici
> (`POST`, `PATCH`, `PUT`, `DELETE …/campaigns/{id}/vouchers`,
> `GET …/webshop-vouchers`, `GET …/webshop-offices`) sont **retirées** ; seule la
> lecture `GET …/campaigns/{id}/vouchers` reste, pour voir les anciens bons et
> ce qu'ils ont rapporté. Le texte ci-dessous décrit le moteur tel qu'il a
> fonctionné. Retrait sans fenêtre de dépréciation : le seul client de ces
> routes est l'écran du module, livré dans le même déploiement.

Un bon — code que le client tape au webshop — se crée dans l'assistant comme une
promotion (sous-étape « Bons » de « Offre & promotions »), mais il vit dans le
**moteur de bons du webshop**, qui l'applique au panier. Le module **n'a aucune
table pour les bons**, pas même le lien : le bon porte la campagne qui le suit
(`voucher_campaign.mar_campaign_id`, migration webshop 0135). Tout passe par
l'API du webshop (`/franchisor/voucher*`, `API.md` du dépôt WebShop, « Vouchers
for the marketing module »), par un seul client, `Support/WebshopClient`.

Règles : un bon ne suit qu'**une** campagne ; **webshop seulement** (la caisse
n'applique pas ces bons) ; les bons d'une campagne réseau se gèrent au niveau du
réseau, une campagne locale émet des bons de **sa** boutique (une seule — sinon
422) ; un bon réservé à un bureau se crée au niveau du réseau. Retirer un bon
créé pour la campagne le **suspend** dans le webshop ; retirer un bon rattaché
le laisse tel quel.

Configuration du serveur : `MAR_WEBSHOP_API_BASE` (adresse de l'API du webshop)
et `MAR_WEBSHOP_API_TOKEN` (le jeton du back-office du webshop, `admin_token`
de sa `config.php`). La CI les écrit dans le `.env` depuis la variable et le
secret GitHub du même nom. Sans eux, la lecture le dit (`configured: false`) et
toute écriture répond `503` — jamais une liste vide qui ferait croire à
l'absence de bon.

**Mécanique « promotions » — un bon qui déclenche les promotions de l'étape
Prix** (validée en octobre 2026). Le bon n'a pas de remise propre : il porte les
promotions cochées parmi celles de l'étape « Prix » (`mar_campaign_offer_item`
avec une mécanique), et au webshop elles ne valent **qu'avec le code**.
- Entrée : `{ mechanic: "promotions", promotions: [offer_item_id, …] }`. Les
  valeurs ne viennent pas de l'écran : le service relit l'étape Prix **en base**
  au moment d'écrire, et envoie au webshop le type `promos` (migration webshop
  0136) : produit ERP, mécanique, valeur, plafond par ticket, cumul.
- Le panier du webshop applique `PERCENT`, `CROSSED_PRICE` et `BUY_X_GET_Y`.
  Une ligne « Prix de formule », « Livraison offerte », sans produit ERP ou sans
  valeur saisie est refusée en 422, nommée, avec la raison.
- La lecture ajoute `campaign_promotions` (chaque promotion de l'étape Prix,
  en clair, avec `webshop` et `reason`) et, par bon, `promotions` (celles qu'il
  déclenche, rapprochées de leur ligne d'offre) et `promotions_changed` : l'étape
  Prix a changé depuis l'envoi. Un `PATCH` sans champ renvoie les valeurs du
  moment ; `promotions` change les cases cochées.
- Le webshop chiffre ces promotions par la même fonction pour l'aperçu du
  panier et pour la commande ; rien n'est écrit dans les tables de promotions
  de l'ERP (la caisse ne les voit pas).

Couches : contrôleur `CampaignVoucherController` (HTTP seul) → service
`CampaignVoucherService` (règles) → dépôt `CampaignVoucherRepository` (seul SQL :
boutique ERP, produit ERP, nom de campagne, promotions de l'étape Prix — en
lecture) et client du webshop. Écarts
résiduels, comme le reste du module : pas d'enveloppe `{success, data, meta}`,
`snake_case`, montants en euros décimaux, collections non paginées (la liste
des bons rattachables est bornée à 200 par le webshop).

## 8. Les promotions de l'ERP (octobre 2026)

`GET …/erp-promotions` montre, dans les onglets de l'offre (Promotions, Bundles &
menus, Bons — rangés sous **Campagnes** dans le menu), les promotions que l'ERP
applique en caisse : **bundles**, **« X achetés = Y »**, **promotions de quantité**,
**remises programmées** et **campagnes de bons**. Elles se créent et se modifient
dans l'ERP ; le module les **lit sur son API** (`ErpClient`), jamais dans ses tables.

Lectures faites à l'ERP, toutes en `GET` du réalm admin, toutes soumises au droit
`MENU.BUNDLE.MANAGE` : `/api/v1/admin/promotions/{bundles | buy-x-get-y | quantity |
scheduled-product-discount}` (liste paginée `{items, pagination}`, puis le détail de
chaque promotion) et `/api/v1/admin/voucher-campaigns` (complètes dans la liste).

**Contrat.** Écrit au format du standard autant que le permet la cohabitation :

- Paramètres (liste blanche, un paramètre inconnu → `422 VALIDATION_FAILED`) :
  `family` ∈ `bundle | buyXGetY | quantity | scheduledDiscount | voucher`,
  `page` (≥ 1), `perPage` (≥ 1, ramené à 100).
- Réponse : `{ success, data[], meta: { requestId, pagination, sources, configured } }`.
  `sources.{famille}` = `{ ok, count, error }` : une famille refusée par l'ERP
  (droit manquant, ERP injoignable) est dite, sans empêcher les autres.
  `configured` est faux sans `MAR_ERP_API_BASE` — rien n'est alors tenté.
- Une promotion : `id` (« famille-idERP »), `family`, `erpId`, `name`,
  `description`, `status` (`DRAFT | ACTIVE | INACTIVE`), `activationMode`,
  `priority`, `shopScope` (`all | selected`), `shops[] {erpShopId, name}`,
  `schedule[] {dayOfWeek (ISO), from, to}`, `validFrom`, `validTo` (dates ISO),
  `mechanic` (propre à la famille, montants en **centimes** : `priceCents`,
  `reward {type: free | percentage | amountOff | fixedPrice, percent, amountCents}`,
  `buyQuantity`, `getQuantity`, `quantity`, `freeQuantity`, `codeType`,
  `sharedCode`…), `products[] {erpProductId, name, quantity, role}`,
  `categories[] {erpCategoryId}`. Noms lus dans le module : `mar_shop.erp_shop_id`,
  `mar_offer_item.sku_ref` (« erp-<id> ») ; à défaut, celui que donne l'ERP.
- Périmètre, appliqué dans le dépôt (`ErpPromotionRepository::visibleTo`) : la
  marque voit tout ; un franchisé, les promotions de tout le réseau et celles qui
  visent une de ses boutiques. `403` sans objet : la lecture est ouverte aux deux
  rôles, filtrée.
- Accès à l'ERP : `MAR_ERP_API_TOKEN` s'il est posé ; sinon une connexion au réalm
  admin (`POST /api/v1/admin/auth/login`) avec `MAR_ERP_API_PHONE` et
  `MAR_ERP_API_PASSWORD` — le jeton de l'ERP expire en 30 minutes
  (`expires_in: 1800`) : un jeton collé en configuration finit refusé.

Tests (`api/tests/smoke.php`, « Promotions de l'ERP ») : 200 et enveloppe, 401,
422 (famille inconnue, paramètre inconnu, page 0), pagination, `perPage` ramené,
filtre par famille, isolation franchisé, idempotence, famille refusée par l'ERP,
ERP non configuré, connexion et reconnexion sur 401. Les réponses de l'ERP y sont
les **exemples que son swagger documente** (`BundlePromotionWrite`,
`QuantityPromotionWrite`, enveloppe de liste, `AuthUserLoginSuccess`) : rien n'est
inventé sur leur forme.

Couches : contrôleur `ErpPromotionController` (HTTP, validation, enveloppe) →
service `ErpPromotionService` (mise en forme des cinq familles) → dépôt
`ErpPromotionRepository` (lectures de l'ERP par `ErpClient`, noms et périmètre en
SQL sur les tables `mar_`). Écart résiduel : le préfixe reste `/api/v1/marketing/`,
sans segment `{app}`, comme toutes les routes du module (§3.2).

## 9. La médiathèque commune (novembre 2026)

Une seule réserve de photos et de vidéos pour tout le marketing : les posts et
les publicités du module Social, les visuels de campagne, les brochures, les
bâches et les affiches. La médiathèque de « Créer un post » vivait dans le
navigateur (IndexedDB) : chaque poste avait la sienne, et un navigateur vidé la
perdait. Tables `mar_media`, `mar_media_category`, `mar_media_season` (migration
039) ; catégories et saisons reprises à l'identique de Social.

**Contrat.** Écrit au standard autant que le permet la cohabitation, comme §8 :

- Réponse `{ success, data, meta: { requestId, … } }` ; erreur
  `{ success: false, error: { code, message, details[] } }`, codes du catalogue
  §7.2 (`VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`, `PERM_ROLE_REQUIRED`).
- Liste : `page` (≥ 1), `perPage` (défaut 25, ramené à 100), `sort` ∈
  `createdAt | updatedAt | name | bytes` (préfixe `-` : décroissant, défaut
  `-createdAt`), filtres en liste blanche `filter[kind][eq]` (`image | video`),
  `filter[category][eq|isNull]`, `filter[subcategory][eq]`, `filter[season][eq]`,
  `filter[offerItem][eq]`, `filter[shop][eq]`, `filter[source][eq]`
  (`marketing | social`), `filter[archived][eq]`, `filter[name][contains]` (cherche
  aussi dans les libellés de catégorie et le nom du produit). Paramètre, filtre,
  opérateur ou valeur hors liste → `422`.
- Une fiche : `id`, `kind`, `name`, `url` (l'original), `thumbnailUrl` (480 px)
  et `webUrl` (2 048 px : ce qu'un post envoie — l'original s'il est déjà léger),
  toutes **absolues**,
  `path` (relatif à la racine du module), `mimeType`, `bytes`, `width`, `height`,
  `category`/`subcategory`/`season` `{code, label}`, `offerItem {id, name}`,
  `shop {id, name}`, `cutout`, `source`, `archived`, `createdAt`, `updatedAt`
  (ISO 8601 UTC).
- Dépôt : le fichier **en corps brut** (`Content-Type` image/…, video/… ;
  classements en query) — une vidéo de 40 Mo ne passe pas par du base64 — ou du
  JSON `{content, poster?, name?, category?, subcategory?, season?, offerItemId?,
  shopId?, cutout?, source?}`. Format reconnu aux octets : PNG, JPEG, GIF, WebP,
  AVIF (20 Mio), MP4, MOV, WebM (45 Mio) ; SVG refusé (il peut porter du script).
  L'original est gardé tel quel (une bâche a besoin de l'original) ; vignette
  480 px et version web 2 048 px, PNG si l'image a de la transparence, JPEG
  sinon. Une image qui demanderait plus de mémoire que le serveur n'en accorde
  (au-delà de 1,5 Go pour la décoder) est déposée sans versions réduites. **Idempotent** : un
  même fichier (empreinte SHA-256) rend la fiche existante (`200`,
  `meta.duplicate: true`), remise dans la médiathèque si elle en avait été retirée.
- Retrait (`DELETE`, ou `PATCH {archived: true}`) : la fiche sort de la liste,
  le fichier reste servi — un post publié ou une brochure peut encore pointer dessus.
- Réservée au réseau : une identité de boutique reçoit `403`. Le module Social y
  accède par son jeton de service (identité réseau), avec `source: social`.

**Écarts résiduels, signalés plutôt que contournés :**

- **Stockage local, pas Cloudflare R2 (§13).** Les fichiers sont écrits dans le
  dossier des envois du module (`MAR_UPLOAD_DIR`, servi sous `/uploads/media/`) ;
  aucun bucket R2 n'est raccordé à ce module. Le contrat est déjà celui que R2
  donnera (`url` et `thumbnailUrl` absolues, nom d'objet tiré côté serveur, type
  en liste blanche, taille par type) : passer à R2 changera `MediaStore`, pas les
  écrans. Il faut pour cela un bucket et ses clés — à fournir.
- **Taille des envois.** PHP refuse un corps plus gros que `post_max_size`
  (souvent 8 Mo par défaut) : le fichier n'arrive pas du tout. `media-library`
  rend cette valeur (`limits.serverMaxBytes`) et l'écran prévient avant
  d'envoyer. Pour accepter les vidéos jusqu'à 45 Mio, relever `post_max_size`
  (64M) et `memory_limit` (256M) dans la configuration PHP du serveur.
- L'adresse absolue vient de `MAR_PUBLIC_BASE_URL` (l'adresse publique du module)
  si elle est posée, sinon de l'hôte par lequel la requête est arrivée.
- Le `401` sans identité garde la forme du routeur (`{status, description}`),
  commune à tout le module ; préfixe sans segment `{app}` (§3.2).

Tests (`api/tests/smoke.php`, « Médiathèque commune ») : 200 et enveloppe, 401,
403 (lecture, dépôt, modification, retrait), 422 (SVG, PHP, champ inconnu,
sous-catégorie d'une autre catégorie, saison ou produit inconnus, couverture qui
n'est pas une image, vide, trop lourd ; paramètres de liste), 404, pagination et
`perPage` ramené, filtres, idempotence du dépôt et du retrait, vignettes, vidéo
et sa couverture.

Couches : contrôleur `MediaController` (HTTP, validation des paramètres,
enveloppe) → service `MediaService` (dédoublonnage, classements, sérialisation)
→ dépôt `MediaRepository` (seul SQL) ; fichiers par `MediaStore`.

## 10. Variables et clés du module (novembre 2026)

Le module doit pouvoir être déplacé dans un autre projet : tout ce qui lui
appartient vit sous `mar_`, ses réglages compris (migration 040).

- **`mar_variable`** `(module, name)` — les réglages, en clair (valeur JSON) :
  adresses de l'ERP et du webshop, délais, dossier des envois, adresse publique.
  La valeur est un `LONGTEXT` (migration 042) : Social y range aussi ses caches
  (pages et comptes Meta, relevé des fiches Google), qui dépassent 64 Ko.
- **`mar_keys`** `(module, name)` — les secrets, **chiffrés** : jetons de l'ERP et
  du webshop, mot de passe du compte de service, secret de session, jeton de
  service. Format `x1:` XChaCha20-Poly1305 (libsodium) ou `g1:` AES-256-GCM
  (OpenSSL), données associées `mar_keys:{module}:{nom}` (une valeur recopiée sous
  un autre nom ne se déchiffre pas). Clé maîtresse de 32 octets **hors de la
  base** : `MAR_KEYS_FILE`, à défaut `master.key` à côté du `.env` — tirée une
  fois par le déploiement, jamais réécrite. La perdre rend les clés illisibles :
  elle se sauvegarde avec le `.env`.
- `module` sépare Marketing (`marketing`) et Social & Ads (`social`), qui fait
  partie du même ensemble et suit le même format.

Lecture (`Config::get`, `Keys::get`) : la base, puis l'environnement (le `.env`
d'avant, en repli le temps de la transition), puis le défaut. Une valeur posée
depuis l'écran l'emporte donc sur le fichier. Restent dans l'environnement, par
construction : l'accès à la base (`MAR_DB_*`), la clé maîtresse
(`MAR_KEYS_FILE`), le chemin d'installation (`MAR_BASE_PATH`) et l'identité de
développement (`MAR_DEV_*` — une base modifiable ne doit pas pouvoir ouvrir le
module à n'importe qui).

Au déploiement, `php db/variables.php import` verse en base ce que le `.env`
porte encore, sans rien écraser ; `list` donne les noms et leur source, jamais une
clé.

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/variables` | marque | enveloppe — chaque réglage avec sa valeur effective et sa source (`base`, `fichier`, `absente`) |
| PUT | `…/variables/{name}` | marque | `{ value }` — enregistre en base ; accès à la base, identité de développement et secrets refusés (`422`) |
| DELETE | `…/variables/{name}` | marque | retire de la base ; le fichier reprend |
| GET | `…/keys` | marque | enveloppe — nom, 4 derniers caractères, source, lisibilité, date ; **jamais la valeur** ; `meta.masterKey.present` |
| PUT | `…/keys/{name}` | marque | `{ value }` — chiffrée ; la réponse ne la contient pas. `MAR_SESSION_SECRET` et `MAR_SERVICE_TOKEN` refusés : entretenus par le déploiement |
| DELETE | `…/keys/{name}` | marque | retire de la base |

Écran : Paramètres › Variables et clés. Tests (« Variables et clés ») :
chiffrement (rien du clair en base), clé maîtresse créée en 0640, valeur
recopiée sous un autre nom indéchiffrable, autre clé maîtresse → illisible et
repli sur le fichier, priorité base > fichier, amorçage refusé, 401, 403, 422,
réponse sans la valeur, import idempotent sans écrasement, secret de session lu
en base.

## 11. L'assistant réunit tous les supports (novembre 2026)

Maquette validée le 04/11/2026 : huit étapes — Cadrage, **Cible**, Produits &
offre, **Supports**, **Contenus**, Budget & validation, Planning, Récap.
Migration 041. Les routes existantes ne changent ni de chemin ni de forme ; elles
gagnent des champs (ajouts compatibles, §14 du standard) :

- `GET …/references` : chaque `channels[]` porte `grp` (`boutique | exterieur |
  social | google | direct`), `description`, `is_paid`, `lead_days` (délai type
  avant le lancement) et `editor` (l'écran qui produit le support) ; `crmSegments[]`
  liste les segments du CRM. Onze supports rejoignent les huit canaux ; les codes
  existants, leur famille `PHYSIQUE | DIGITAL` et « Pub physique / Pub digitale »
  ne changent pas (trois libellés suivent la maquette : Publicité Meta, Google Ads,
  Newsletter, Bâches extérieures, PLV, Distribution toutes-boîtes).
- Création et reprise d'un brouillon (`POST …/campaigns`, `PUT …/campaigns/{id}/draft`,
  `GET …/campaigns/{id}/draft`) : `channels[]` porte `quantity` et `details` ;
  `segment_ids[]` (segments du CRM visés, un identifiant inconnu est ignoré) ;
  `messages[]` `{lang: fr | nl, title, hook, offer_line, cta}` — le message que
  chaque support décline (une langue entièrement vide n'est pas gardée). Plusieurs
  cibles se cumulent : particuliers (avec leurs segments) et professionnels (avec
  leurs secteurs) — `client_target = mixte`.
- `…/shop-supports` (nouvelle, au standard) : les bâches (emplacement, largeur et
  hauteur en cm, matière `pvc | mesh`, fixation `oeillets | fourreaux | sangles`,
  quantité) et les cadres d'affiche (`A1 | A2 | A3`, quantité) de chaque boutique,
  déclarés dans Marketing en magasin › Bâches & affiches, repris par la carte
  « Bâches extérieures » / « Affiches » de l'assistant. Validation stricte (un champ
  inconnu ou une valeur hors liste refuse l'envoi entier), écriture réseau seul,
  lecture filtrée dans le dépôt pour une boutique.
- « Proposer avec Claude » (étape Contenus) appelle la rédaction du module Social
  (`…/social/redaction/proposer`), selon sa charte éditoriale : pas de second
  moteur de rédaction ici.

Tests (« Assistant : supports, cible, message », « Bâches et affiches des
boutiques ») : référentiel, aller-retour du brouillon, reprise sans doublon,
suppression en cascade ; 401, 403, 404, 422, pagination, filtres, isolation d'une
boutique, idempotence, liste vide.


## 12. Après la validation : fil de production, kit des franchisés, prime (novembre 2026)

Maquette validée le 05/11/2026. Migration 043, seed 007. Routes nouvelles au
standard (enveloppe `{success, data, meta}`, camelCase, codes d'erreur du §7.2,
montants du kit en centimes) ; écart résiduel : préfixe sans segment `{app}`
pour les routes réseau, comme le reste du module.

- `GET …/campaigns/{id}/production-sections` — le fil de production : une
  section par élément de la campagne (le message, chaque support coché, les
  consignes si des questions en caisse, les tenues, la vitrine, la prime), dans
  l'ordre des familles, avec son état `todo | doing | ready | validated`, son
  échéance (`dueOn` = début − délai du support) et, pour les bâches (`affichage`)
  et les affiches, le BAT de chaque boutique avec ses emplacements déclarés.
  Liste bornée par la campagne (une trentaine de sections au plus) : pas de
  pagination. 409 `RESOURCE_STATE_INVALID` tant que la campagne est en brouillon.
- `PUT …/production-sections/{section}` `{status, note}` — réseau seul (403
  sinon). Une section par boutique ne se valide qu'une fois toutes les boutiques
  d'accord (409). Idempotent.
- `PUT …/production-sections/{section}/shops/{shopId}` `{status, note}` — le
  réseau : `todo | sent | validated | redo` ; le franchisé, pour ses boutiques
  seulement (404 sinon) : `validated | redo` avec son retour. Un BAT qui repart
  rouvre la section.
- `GET …/campaigns/{id}/kit-versions` — versions envoyées, lien et lecture de
  chaque boutique (un franchisé ne voit que les siennes).
- `POST …/campaigns/{id}/kit-versions` `{posts: [...]}` — réseau seul ; 409 tant
  qu'une section reste à valider. Fige une version : un kit par boutique (message,
  offre, dates de la boutique, calendrier des posts, bâches et affiches,
  supports, tenues, questions en caisse, prime). Les posts viennent de Social
  (Créer un post, posts rattachés à `bo-{id}`, hors dark posts), lus par l'écran
  et validés ici (dates, heures, adresses d'image http(s), 300 au plus). 201.
- `GET …/campaigns/{id}/kit-previews/{shopId}` — le kit tel qu'il partirait
  (sans les posts, que l'écran ajoute).
- `GET /api/v1/public/marketing/campaign-kits/{token}` — **publique** : le kit
  d'une boutique par son lien personnel, en lecture seule, sur la tablette.
  Lien de 43 caractères, HMAC du secret de session et d'un sel ; la base n'en
  garde que l'empreinte (sha256). Stable d'une version à l'autre ; valable
  jusqu'à 30 jours après la fin de la campagne (60 jours au moins). 404 si
  inconnu ou expiré.
- `PUT /api/v1/public/marketing/campaign-kits/{token}/read-receipt` —
  **publique**, idempotente : la première lecture de la version reste.

Le PDF est l'impression du kit (A4, une page par partie, couverture) : la page
du lien propose « Télécharger le PDF ». Il n'y a pas de moteur PDF sur le serveur.

Prime de la marque pour le personnel — création et reprise d'un brouillon
gagnent (ajouts compatibles) : `staff_bonus_enabled`, `staff_bonus_who`
(`team | named`), `staff_bonus_rule` (`attainment | per_piece | ranking`),
`staff_bonus_threshold_pct`, `staff_bonus_amount`, `staff_bonus_extra_pct`,
`staff_bonus_extra_amount`, `staff_bonus_cap_amount` (en euros, comme le budget
de la campagne), `staff_bonus_form` (`voucher | gift_cheque | franchisee`),
`staff_bonus_paid_on` ; `shop_targets[].staff_headcount` (l'équipe de vente,
saisie à la main). Une prime attachée sans montant est refusée (422).

Supports ajoutés (seed 007) : `bons_imprimes` (cartes remises en caisse avec le
code d'un bon ; depuis le §13, ce bon vit dans TFBuddy et vaut en caisse comme
au webshop) et `goodies` (sacs, stickers, badges).

Tests (« Fil de production et kit des franchisés ») : 200, 401, 403, 404, 409,
422, isolation d'une boutique, idempotence, lien sans session, empreinte seule
en base, nouvelle version au même lien, prime enregistrée et refusée.

## 13. Les bons dans TFBuddy (novembre 2026)

Décision du 05/11/2026 : « le webshop doit venir de TFBuddy ». Le webshop
applique les bons de TFBuddy (même moteur que la caisse) : un bon créé ici vaut
**en caisse et au webshop**. La remise vient de l'étape « Prix » ; les anciens
bons du webshop restent visibles en lecture (§7).

**Ce qu'est un bon.** Une campagne de bons de l'ERP
(`/api/v1/admin/voucher-campaigns` : un code pour tous `SHARED`, ou des codes
uniques `UNIQUE`) rattachée à **une** promotion de l'ERP en mode
`VOUCHER_ONLY` — elle ne vaut qu'avec le code. La promotion est faite d'une ligne
de l'étape Prix (`mar_campaign_offer_item`) :

| Mécanique de la ligne | Promotion de l'ERP |
|---|---|
| `PERCENT` | `scheduled-product-discount`, `PERCENTAGE_DISCOUNT` |
| `CROSSED_PRICE` | `scheduled-product-discount`, `FIXED_PRICE` |
| `BUY_X_GET_Y` | `buy-x-get-y`, récompense `FREE`, la moins chère |
| `BUNDLE_FIXED`, `FREE_DELIVERY`, produit sans référence ERP, valeur non saisie | refusée (`422`, raison nommée) |

Périmètre de la promotion : les boutiques de la campagne (`SELECTED_SHOPS`,
`mar_shop.erp_shop_id`), ou tout le réseau (`ALL_SHOPS`). Plafond par ticket de
l'offre repris. Fin : celle saisie, sinon celle de l'offre, sinon celle de la
campagne.

**Séquence d'écriture** (celle du cockpit, essayée sur l'ERP le 24/10/2026) :
1. `POST /admin/promotions/{famille}` — `status: INACTIVE`, `activation_mode: VOUCHER_ONLY` ;
2. `POST /admin/voucher-campaigns` — `status: DRAFT`, code commun ou limite d'une utilisation par code ;
3. codes uniques : `POST …/{id}/codes/generate` par lots de 100 (`length: 8`, préfixe saisi, ou trois lettres de chaque boutique) ;
4. `PUT …/{id}/promotion` `{id_promotion, confirm_activation_mode_change: true}` (`409` = déjà rattachée) ;
5. activation, seulement si elle est demandée : `PATCH` de la promotion puis de la campagne de bons
   (`PATCH …/{id}/status` ; l'ERP le refuse pour un bon `UNIQUE` : repli sur `PATCH …/{id}`).
   Suspension : le même chemin avec `INACTIVE`.

L'ERP n'a pas de transaction : si une étape échoue, le message dit ce qui reste
dans l'ERP (« la promotion n° … reste inactive », « le bon n° … reste en
brouillon ») et le module ne garde rien. Rien ne passe en caisse avant
l'activation, qui reste un geste explicite (confirmation à l'écran).

**Stockage.** Migration 044 : `mar_campaign_erp_voucher` — le lien entre la
campagne et le bon de l'ERP (l'ERP n'a pas de champ pour la campagne), et de quoi
le retrouver (`erp_voucher_campaign_id` unique, `erp_promotion_id`, famille, type
de code, code commun, codes demandés). L'état, les codes et les utilisations sont
**relus dans l'ERP** à chaque lecture (`GET …/{id}` et `…/{id}/codes`, 200 par
page) ; un bon illisible est dit (`readError`), jamais tu.

**Contrat** (au standard, comme les routes nouvelles) :
- `GET …/campaigns/{id}/erp-vouchers` → `data {campaignId, configured, message,
  canEdit, vouchers[], lines[]}`. Un bon : `id, name, offerItemId,
  erpVoucherCampaignId, erpPromotionId, promotionFamily, codeType, sharedCode,
  codesRequested, createdAt, status (DRAFT | ACTIVE | INACTIVE), validTo,
  redemptions, complete, missing[], codes[] {code, status, usages, limit},
  codesTotal, readError`. Une ligne : `offerItemId, label, mechanic,
  mechanicLabel, summary, eligible, reason`. Collections bornées par la
  campagne (quelques bons, lignes de l'offre) : pas de pagination.
- `POST …/campaigns/{id}/erp-vouchers` — champs en liste blanche :
  `offerItemId` (requis), `codeType` (`SHARED | UNIQUE`), `sharedCode` (4 à 20
  `A-Z 0-9 -`, tiré au hasard si vide), `usageLimitTotal`, `count` (1 à 2000,
  `UNIQUE`), `perShop`, `prefix` (8 au plus), `validFrom`, `validTo`
  (AAAA-MM-JJ), `usageLimitPerCustomer`, `activate`. `201` avec le bon relu ;
  une activation refusée après création répond `201` avec `warning`.
- `PATCH …/campaigns/{id}/erp-vouchers/{voucherId}` `{status}` — idempotent.
- Erreurs : `401` ; `403 PERM_ROLE_REQUIRED` (franchisé sur une campagne
  réseau) ; `404 RESOURCE_NOT_FOUND` (campagne invisible pour l'appelant, bon
  d'une autre campagne) ; `422 VALIDATION_FAILED` (champ nommé, ou refus de
  l'ERP avec sa raison) ; `502/503 DEPENDENCY_UNAVAILABLE` (ERP qui refuse le
  compte, ou `MAR_ERP_API_BASE` vide).
- Accès à l'ERP : celui du §8 (`MAR_ERP_API_TOKEN`, ou le compte de service) ; il
  doit pouvoir **écrire** les promotions et les campagnes de bons.

**Écarts résiduels.** Préfixe sans segment `{app}` (§3.2). `POST` sans clé
d'idempotence : deux envois créent deux bons dans l'ERP — l'écran bloque le
bouton pendant l'écriture. Pas d'OpenAPI du module (l'écart du §3 vaut ici).

Tests (« Bons dans TFBuddy », ERP simulé aux formes de son swagger et de la fiche
relue par le cockpit — aucun compte de test TFBuddy) : 401, 200, lignes
éligibles et raisons, 422 (champ inconnu, codes sans nombre, code illisible, fin
avant début, prix de formule, produit hors ERP), 404, ordre et corps des appels,
codes par lots (100 + 100 + 50), activation et repli `UNIQUE`, suspension
idempotente, refus de l'ERP sans trace, 403 franchisé, isolation d'une boutique,
ERP non configuré (503). Le premier vrai bon se crée en production, par un geste
de la personne qui pilote la campagne.
