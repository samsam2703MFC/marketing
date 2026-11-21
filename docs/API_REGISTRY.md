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
| GET | `…/shops` | tenant | tableau — chaque boutique porte `erp_shop_id` (identifiant TFBuddy, `null` si non relié) |
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
| GET | `…/campaigns/{id}` | tenant | objet — `shops[]` porte `erp_shop_id` |
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

**21/11/2026 — la liste des campagnes porte son type.** `GET …/campaigns` rend aussi `type_id` (entier ou `null`) et
`type_color_hex` (la couleur du type) : le cockpit range et colore les bandes de son calendrier et de son budget par type,
et ne lit plus `mar_campaign` ni `mar_campaign_type`.

**21/11/2026 — la fiche d'une campagne pour la mesure.** `GET …/campaigns/{id}` rend aussi `type_lever_code` (le code du
levier lié au type) et, dans `offer.items[]`, `sku_ref` et `catalog_name` (la référence et le nom du produit au
catalogue ; `null` pour un produit saisi à la main). Le brouillon (`…/draft`) les porte aussi. La mesure des campagnes du
cockpit lit cette fiche au lieu de `mar_campaign_offer*`, `mar_offer_item` et `mar_lever`.

**21/11/2026 — la fiche d'une campagne pour la note.** `GET …/campaigns/{id}` rend aussi le type et son levier
(`type_icon_path`, `type_color_hex`, `type_default_kpi_label`, `type_lever_id`, `type_lever_badge_label`, `type_lever_label`,
`type_lever_color_hex`), `render_formats` (les formats de déclinaison des visuels, une fois chacun : `id`, `name`, `width_px`,
`height_px`, `note`, `sort_order`) et, dans `channels[]`, `agency_id`. La note de campagne du cockpit lit cette fiche.

**21/11/2026 — boutiques des campagnes et tous les leviers.** `GET …/campaigns` rend aussi `shop_ids` (les boutiques de
chaque campagne, entiers, liste vide pour une campagne réseau sans liaison) ; `GET …/references` rend aussi `allLevers` (tous
les leviers, inactifs compris : `id`, `code`, `label`, `color_hex`, `sort_order`, `is_active`, dans l'ordre du réseau). Le
hub, les visites, les objectifs produits et les KPI par levier du cockpit lisent ces deux réponses.

**21/11/2026 — visibilité et investissement.** `POST` et `PATCH …/funds/movements` acceptent `is_public` (booléen,
`true` par défaut à la création) et `is_investment` (booléen, retenu sur une sortie seulement, `false` par défaut) ; le
grand livre les rend sur chaque ligne. Une correction qui ne les porte pas garde les valeurs en place (jusqu'ici, le
contrôleur écartait `is_public` et toute correction rendait la ligne publique). La colonne `is_investment` vient de la
migration 053. Le cockpit (dépôt `consultant_BO`) écrit désormais le fonds, ses frais récurrents et les types de
campagne par ces routes, avec le jeton de service (`X-Marketing-Service`), et plus jamais dans les tables.

### 2.4 Outils de campagne et diffusion

| Méthode | Chemin | Périmètre | Réponse |
|---|---|---|---|
| GET | `…/promotions` | tenant | tableau |
| GET | `…/bundles` | tenant | tableau |
| GET | `…/vouchers` | tenant | tableau |
| GET | `…/erp-promotions?family=&page=&perPage=` | tenant (franchisé : réseau + ses boutiques) | enveloppe + `data[]` paginé — §8 |
| GET | `…/diffusion` | tenant | objet |
| GET | `…/agencies` | — | tableau — porte aussi `email`, `site`, `logo_uri`, `is_default`, `channel_campaigns` (21/11/2026) |
| GET | `…/agencies/{id}/campaigns` | tenant | tableau |
| POST | `…/agencies` | réseau | enveloppe — `201`, l'agence (camelCase) — §15 |
| PATCH | `…/agencies/{id}` | réseau | enveloppe — les champs envoyés seuls — §15 |
| DELETE | `…/agencies/{id}` | réseau | `204` ; `409 RESOURCE_STATE_INVALID` si un canal ou une intervention la désigne — §15 |
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
| GET | `…/media-tag-proposals?page=&perPage=&filter[media][eq]=` | marque | enveloppe + `data[]` paginé (fichier + ses propositions), `meta.proposals` — §9 |
| POST | `…/media-tag-proposals` | marque | enveloppe — `{created, skipped, proposals}`, `201` / `200` (idempotent) |
| PATCH | `…/media-tag-proposals` | marque | enveloppe — `{ids, status}` : « Tout accepter », ✓ / ✕ d'une ligne |
| PATCH | `…/media-tag-proposals/{id}` | marque | enveloppe — ✓ / ✕ ; décision contraire sur une proposition tranchée : `409 RESOURCE_STATE_INVALID` |

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
| 16 | Pas d'OpenAPI, sauf pour les catalogues (`docs/openapi/catalogues.yaml`, §14, novembre 2026). Ailleurs, ce registre est le seul contrat écrit. | module entier sauf catalogues |
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
- **Étiquettes (17/11/2026, OpenAPI `docs/openapi/media.yaml` v1.1).** Demande : « taguer
  les images », retenues les idées 1 (sur la fiche) et 2 (proposées, à valider) de la maquette
  `docs/maquettes/mediatheque/`, « en rectangles au coin arrondi », puis « un assistant d'import
  en lot avec la proposition des tags ». Pourquoi : la régie d'affichage (`signage`) tire au
  sort une image du moment courant et d'une saison active, a besoin du produit montré et du sens
  de l'image. Migration 052 : `mar_media_tag` (moment `matin | midi | apres-midi` — aucun = toute
  la journée —, usage `ecrans | reseaux | catalogue | webshop | affiche`, produit = id du produit
  du webshop/ERP et son nom, libre), `mar_media_tag_proposal`, `mar_media.valid_until`. La fiche
  rend `tags {moments, usages, products, free}`, `validUntil`, `format` (`carre | portrait |
  paysage`, lu dans la taille à 5 % près, jamais stocké) et `pendingProposals`. `PATCH` accepte
  `moments`, `usages`, `products` (8 au plus), `freeTags` (12 au plus), `validUntil` : chaque
  famille envoyée remplace la précédente et tranche ses propositions en attente (acceptées pour
  les valeurs retenues, refusées pour les autres) ; une saison ou le détourage choisis à la main
  font de même. Ces champs ne passent pas au dépôt (`POST`, corps brut) : l'assistant d'import
  dépose, puis pose les étiquettes. Filtres `filter[moment|usage|product|tag|format|valid][eq]`.
- **Propositions.** Faites par l'écran (règles dans `src/views/media/tagRules.ts`) : le produit
  d'après le nom du webshop (ou la photo du webshop versée), le moment d'après le rayon ou la
  catégorie (viennoiserie → matin, traiteur, sandwich, salade, quiche → midi, pâtisserie, tarte,
  biscuiterie, cookie → après-midi), la saison d'après un nom de fête, le détourage d'après la
  transparence du fichier. Chacune dit d'après quoi (`reason`). Le serveur valide (fichier, famille,
  valeur, saison existante, nom du produit), passe ce qui est déjà appliqué ou déjà proposé — un
  ✕ ne revient pas — et applique un ✓ à la fiche. `media-library` rend `counts.proposals`.
  Écart : les règles vivent dans l'écran, pas encore dans les réglages de la médiathèque
  (maquette 6) ; elles y passeront quand l'écran des réglages sera codé.
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
- **`erp_cles`** (depuis le 7 nov. 2026, migration 046 ; c'était `mar_keys`) — la table des
  clés **commune à tout l'ERP** : une ligne par clé (`cle`, `valeur`, `secret`, `indice`,
  `portail`, `integration`, `maj_le`, `maj_par`). Les lignes du Marketing portent
  `portail = mar` et le nom `mar.{module}.{nom}` (`mar.marketing.MAR_SESSION_SECRET`,
  `mar.social.meta_system_token`) ; leur valeur reste **chiffrée** : jetons de l'ERP et
  du webshop, mot de passe du compte de service, secret de session, jeton de
  service. Les clés `commun` des intégrations partagées (Meta : `meta_app_id`,
  `meta_app_secret`, `meta_system_token`…, jeton de service entre portails
  `erp_jeton_service`) sont en clair, tenues par le portail qui les saisit et lues par leur
  nom. `mar_keys` reste lue en repli jusqu'à sa suppression. Format `x1:` XChaCha20-Poly1305 (libsodium) ou `g1:` AES-256-GCM
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

## 14. Les catalogues produits (novembre 2026)

Des catalogues imprimés tirés du **webshop** (prix web, gammes : Noël, Saint-Nicolas…), de
**8 à 16 pages, toujours par 2** (`pageCount` : 8, 10, 12, 14 ou 16 — client, 14 novembre 2026 :
« rajouter une page, c'est toujours par 2 » ; choisi à la création, modifiable par 2) : quatre pages fixées par
la **Charte des catalogues** de la marque et verrouillées — couverture (page 1), page 2,
avant-dernière et dernière (« commandez en ligne ») —, et 4 à 12 pages intérieures (nombre
fixé par le format) remplies par catégorie du webshop dans l'une de trois
mises en page (`vedette` 1 + 4, `grille` 2 × 3, `liste` 12 avec prix), A5 ou A4, FR / NL, une
version générale et une version par boutique (prix de SA boutique, son QR, son adresse).
Contrat écrit **avant le code** : `docs/openapi/catalogues.yaml` (premier OpenAPI du module).

**Sources (lecture seule).** Rien du webshop n'est recopié. Les produits, photos, catégories,
gammes et prix sont relus dans TFBuddy par le client unique de l'ERP (`ErpClient`,
`WebshopCatalogueRepository`), avec les mêmes lectures que « Créer un post » du module Social :
`GET /api/v1/shops/{id}/products/available?webshop_active=1&alias_type=webshop&include=webshop,portions,availability_periods,webshop_availability`
(FR, puis NL pour les noms ; `webshop.price_gross` = prix du webshop de la boutique,
`portion_price` = prix au comptoir, `availability_periods` = gammes ; cartons B2B écartés),
`GET /api/v1/product-availability-periods` (gammes actives) et `GET /api/v1/public/shops`
(adresse, horaires, téléphone ; `GET /api/v1/shops` en complément). Gardé 30 min (produits) et
15 min (gammes, boutiques) dans `mar_catalogue_cache` — un cache, pas une copie ; TFBuddy muet :
la dernière lecture, et l'erreur est dite (`WEBSHOP_UNREADABLE`). Campagne : les produits ERP de
son offre (`mar_offer_item.sku_ref` = `erp-{id}`) et ses boutiques. Adresse du webshop (QR) :
réglage `webshop_url` du module Social, à défaut `MAR_WEBSHOP_URL` ; sinon pas de QR, dit.

**Stockage.** Migration 047 : `mar_catalogue` (titre, propriétaire `marque | boutique`,
`shop_id`, source `gamme | campagne | choix` et sa référence, format, état
`brouillon | pret | imprime`, exemplaires, réglages JSON validés : langues, boutiques des
versions, nombre de pages `pageCount`, produits `{id, on}`, pages intérieures `{layout, category}`),
`mar_catalogue_cache`. Migration 049 : `pageCount` posé une fois sur les catalogues d'avant (le plus
petit de 8 / 12 / 16 qui contient leurs pages intérieures + 4 ; aucune page retirée, une liste plus
courte est complétée de pages vides à la lecture). La charte vit dans `mar_variable`
(`catalogues.charte` : logo de la médiathèque, couleurs, couvertures par gamme avec une générique,
page 2 et avant-dernière page — titre, texte, image, FR / NL —, dernière page FR / NL).

**Nombre de pages (novembre 2026).** `pages` = exactement `pageCount − 4` pages intérieures : plus
courte, complétée de pages vides (« Notre sélection », qui prend les produits restés sans place) ;
plus longue, `422 VALIDATION_FAILED` (`pages`) ; `[]` = répartition automatique sur ce nombre exact
(grilles, puis listes si ça ne tient pas ; `PAGES_EMPTY` / `PRODUCTS_OVERFLOW` au document). Changer
`pageCount` sans `pages` : des pages vides s'ajoutent à la fin ; en réduisant, seules des pages de la
fin SANS produit partent — sinon `422 CATALOGUE_PAGES_NOT_EMPTY` (une ligne par page) et rien n'est
écrit. Le document rend `pageCount` pages : `cover`, `brand` (`slot: page2`), les pages intérieures,
`brand` (`slot: penultimate`), `back` — les quatre de la marque `locked: true`.

**Pages de présentation, gabarits, place libre (14 novembre 2026).** Demandes du client : « une
page de présentation (seule ou avec liste de produits), templates et layout ; chaque gamme doit avoir
son illustration », « choisir à chaque fois 2-3 possibilités », puis « chaque page a sa catégorie,
avec possibilité, s'il y a de la place, de mettre soit une photo (de la médiathèque) soit une
illustration ». Une page intérieure est désormais `{layout, category, template?, gamme?, text?,
textNl?, filler?, fillerMediaId?}` (`OpenAPI v1.2`, ajouts compatibles : `{layout, category}` reste
valable, sans `template` = A). `layout` gagne `presentation` (illustration, nom de la gamme, texte)
et `presentation_liste` (la même avec les 8 premiers produits de la gamme et leurs prix) — `gamme`
y est obligatoire (une gamme active du webshop), `text` / `textNl` 400 caractères au plus.
`template` ∈ `A · B · C` sur toute page (produits : classique · bandeau · épuré ; présentation :
illustration · pleine couleur · photo pleine). Sur une page de produits, `gamme` ne prend que les
produits de cette gamme ; `filler` = `photo` (+ `fillerMediaId` : image de `mar_media`, pas
archivée ; pour une boutique, du réseau ou d'elle-même) ou `illustration` (le dessin de la gamme de la
page — ou de la première gamme du catalogue —, sinon le dessin de la famille de la catégorie,
`img/print/…` et `img/…` livrés avec le module : jamais une image inventée). Tout autre valeur :
`422 VALIDATION_FAILED`, champ nommé (`pages[i].template`…), rien n'est écrit. Rangement au plus
court (seuls les champs qui ne valent pas leur défaut). Le document : pages `presentation`
(`imageUrl` = visuel de la couverture de la gamme dans la charte, sinon photo du webshop ;
`drawing` / `drawingUrl` = dessin de saison ; ni l'un ni l'autre : un cadre sobre et
`GAMME_NO_ILLUSTRATION`) ; pages `products` avec `template`, `gamme`, `drawing` (rappel dans
l'en-tête), `room`, `fillable` (une rangée entière libre) et `filler`. **Répartition automatique** d'un
catalogue de plusieurs gammes : chaque gamme commence par sa page de présentation, puis ses
produits par catégorie ; sans la place, la présentation porte la liste (`presentation_liste`), puis
les pages passent en listes. Réduire `pageCount` ne retire jamais une présentation en silence
(`CATALOGUE_PAGES_NOT_EMPTY`). Nouvelle route du dashboard : `GET …/shops/{shopId}/catalogue-media`
(ci-dessous).

**Promotions, bundles et disponibilité (14 novembre 2026, `OpenAPI v1.3`).** Demandes du client :
« rajouter les bundles et promotions (via API) et les appliquer dans une vignette dans la catégorie », puis
« rajouter aussi les données de disponibilité ». **Lues** (même chemin que les autres lectures : compte du
Marketing, sinon celui de Social ; jamais d'écriture) : `GET /api/v1/admin/promotions/bundles`,
`/buy-x-get-y`, `/quantity`, `/scheduled-product-discount` (`status=ACTIVE&limit=100`, liste `{items,
pagination}` puis la fiche `/{id}` de chacune — la liste ne porte que des compteurs), mises à la forme du
module par `ErpPromotionService::normalize` (celle de la route `erp-promotions`) : `bundle_promotion.bundle_price`
et `items[].id_product/quantity` ; `trigger`/`reward` (`quantity`, `product_ids` ou `products`, `category_ids`
ou `categories`, `type`, `value`) ; `quantity_promotion` (`mechanism_type`, `bundle_quantity`, `free_quantity`)
et `eligible_product_ids` ; `reward_product_ids`, `reward_category_ids`, `discount_type`, `discount_value` ;
`valid_from`/`valid_to`, `schedule[]`, `shop_scope_type`/`shop_ids` (texte « 4,5 » accepté),
`activation_mode`. Version d'une boutique : `GET /api/v1/shops/{id}/scheduled-product-discounts/active` (non
décrite par le swagger : identifiants `id_promotion`, `promotion_id` ou `id` ; illisible = la liste du
réseau fait foi). Gardé 15 min (`mar_catalogue_cache`, clés `promotions`, `remises-actives:{id}`).
**Appliquées** : actives, pas « avec un bon seulement » (`VOUCHER_ONLY`), du réseau (version générale) ou de la
boutique de la version, valables pendant que le catalogue circule (la période de sa première gamme datée,
sinon dès aujourd'hui ; une promotion finie ne s'imprime jamais), touchant au moins un produit ou une
catégorie lus ; un bundle dont un produit n'est pas vendu par la boutique est écarté. Un bundle, un « X achetés
= Y », une promotion de quantité = une **vignette** (`kind: offer` au document : badge « Bundle » · « 2+1 » ·
« 3 pour 2 », phrase « le 3e offert », produits et photos, prix et ancien prix quand on les connaît — bundle :
`bundle_price` et la somme de ses produits aux prix de la version ; X+Y sur un seul produit : prix des X et des
X + Y —, période « du 1/12 au 6/12 · le week-end · 8h–12h ») qui **occupe une case** de la page de la
catégorie de son premier produit (devant ses produits ; jamais dans la liste d'une présentation) ; une remise
programmée **barre le prix** des produits visés (`oldPriceCents`, `promo.label` « −10 % »). **Choix** :
`offers: [{type, id, on}]` (`type` ∈ `bundle · buyXGetY · quantity · scheduledDiscount`) dans les réglages ;
une offre absente est cochée d'office si elle touche un produit coché ; type inconnu, forme, ou identifiant
que TFBuddy ne rend pas pour ce catalogue → `422 VALIDATION_FAILED` (`offers[i].type|id|on`) ; TFBuddy muet :
les choix sont gardés tels quels. TFBuddy muet au document : alerte `PROMOTIONS_UNREADABLE`, aucune vignette,
aucun prix barré. **Disponibilité** : `availability` de chaque produit de `catalogue-products`
(`periods[{id, from, to}]` en JJ/MM — `from_md`/`to_md`, sinon `start_date`/`end_date` de la période sur la
ligne du produit, sinon ceux de la gamme — et `leadHours` = `preparation_lead_time_hours` de l'ERP, 0 = rien) ;
au document, sous le prix, « du 1/12 au 6/12 · sur commande 48 h » (NL « van 1/12 tot 6/12 · op bestelling
48 u ») — la période d'une gamme du catalogue, sinon la seule du produit ; rien de connu : `null`.
`showAvailability` (booléen, vrai par défaut ; autre valeur `422`) l'éteint. Le swagger ne décrit pas de
jours de la semaine ni de précommande pour un produit : rien de tel n'est lu.

**Une catégorie = sa page, en-têtes, grandes vignettes (14 novembre 2026, `OpenAPI v1.4`).** Demande du client
(capture d'une page « COUGNOU · NOËL · FROMAGES & SALAISONS » qui mélangeait trois catégories après l'ajout
d'une catégorie) : « quand je rajoute une catégorie, la catégorie est sur une page avec son illustration (2 ou 3
possibilités de montrer le titre et l'illustration) et 3-4 possibilités de montrer les produits ». **Répartition
automatique** : une page (ou plus) par catégorie ; sans la place même en listes, la dernière page devient
« Notre sélection » en liste. **Ajout** : un `PUT` qui change `products` sans `pages` (`placeCategories`) donne sa
page à chaque catégorie qui a gagné des produits cochés et ne tient plus dans ses pages — une page vide reprise
(sans produit, ni présentation ; placée juste après les pages de la catégorie quand elle continue), sinon
`pageCount` + 2 (16 au plus, les deux pages avec le gabarit et l'en-tête de la première page de produits), sinon
rien ne bouge ; au document, `CATEGORY_NO_PAGE` nomme la catégorie (« ses produits vont en « Notre sélection » »
ou « n'ont pas de place » ; « plus de place : 16 pages »). Retirer une catégorie laisse sa page vide (jamais
retirée en silence ; elle est la première reprise). Les vignettes de promotions ne sont pas comptées par ce
calcul (le document dit le débordement). **`header`** d'une page de produits : `titre` (défaut, absent) ·
`bandeau` · `grande` ; autre valeur `422 VALIDATION_FAILED` (`pages[i].header`), ignoré sur une présentation ;
rangé dans l'ordre fixe des clés d'une page (`PAGE_KEYS`, MySQL 8 réordonne les clés JSON). Distinct du gabarit
A · B · C (fond, cartes, alignement) : B a déjà un bandeau avec un petit pictogramme, mais ni A ni C ne font la
« grande illustration », d'où un réglage à part. **Illustration** (`drawing`, `drawingUrl` absolue) : le dessin
de la famille de la catégorie (la règle des vignettes sans photo, `familyImage`), sinon la gamme de la page, sinon
la première gamme du catalogue, sinon `null` — jamais inventée. **`mosaique`** : grandes vignettes 2 × 2,
4 produits (place libre à 2 produits au plus). **`pleine`** (17/11/2026, client : « une possibilité de produit
pleine page, 1 seul produit et sa promotion ») : un produit sur toute la page, le champ de page `product` (seulement
avec `pleine`, sinon `422 pages[i].product`) le choisit et le réserve à sa page avec sa promotion (la première
vignette qui le contient) ; sans `product`, le premier de sa catégorie ; absent de la version : `PAGE_PRODUCT_MISSING`.
Une page vide reprise pour une catégorie ajoutée repasse en `grille`. `catalogue-products` de la boutique rend `headers`. **Disponibilité en pied de page** (même jour, client : « la disponibilité en dessous de page en
footer (par catégorie) ») : `availabilityFooter` sur chaque page de produits (et présentation avec liste), composé
par le serveur pour que Marketing et dashboard impriment la même ligne (`availabilityFooter()`) — tous la même :
« Disponible du 1/12 au 31/12 · sur commande 48 h » (NL « Beschikbaar … ») ; sinon la plus courante puis les
produits qui diffèrent (« Bûchette individuelle : du 1/12 au 24/12 », un produit sans donnée : « voir en
boutique ») ; au-delà de 80 caractères (une ligne en A5), la plus courante + « certains produits : voir en boutique » ; aucune donnée
ou `showAvailability` faux : `null`. `availability` reste sur chaque produit (API), plus imprimé sous le prix ; les
vignettes de promotions gardent leur période. **Image d'une vignette d'offre** (même jour, capture d'une vignette « Cougnou 4+1 » au cercle vide : « insert
picture from médiathèque ») : `offers[i].mediaId` — une image de la médiathèque, même règle que la place libre
(pas archivée, pas une vidéo ; pour un catalogue de boutique, du réseau ou d'elle-même), sinon `422`
`offers[i].mediaId` ; `null` la retire. Rendu toujours `{type, id, on, mediaId}` dans cet ordre (MySQL 8). Au document,
la vignette porte `imageUrl` (elle remplace les photos des produits) ; image disparue : `OFFER_MEDIA_MISSING` et les
photos. Sans photo ni image : le dessin de la famille de la page (sinon l'illustration de l'en-tête), plus de cercle vide. **En-tête gamme puis catégorie** (même jour, capture d'une page « NOËL » au petit pictogramme : « commencer avec
le nom de la gamme et son illustration, ensuite catégorie produit (possibilité ou pas en lettres manuscrites), ensuite les
produits ») : la gamme de la page, sinon celle des gammes du catalogue que portent le plus de ses produits
(`gammeTitle`, illustration `drawing` / `gammeImageUrl` : charte, photo du webshop, dessin de saison), puis la catégorie
(`title`) en sous-titre ; les trois en-têtes (`titre` · `bandeau` · `grande`) s'appliquent à ce bloc. Sans gamme
(catalogue « au choix », « Notre sélection ») : la catégorie seule, avec le dessin de sa famille. `script` (booléen par
page, rangé seulement vrai, `422` sinon) : la catégorie en lettres manuscrites — Playwrite DE VA, la police manuscrite
déjà livrée avec le module (`public/fonts`, la même que le Studio visuel) et avec le design system du cockpit ; aucune
police ajoutée. `familyDrawingUrl` : le dessin de la famille du titre (vignettes sans photo, dashboard).

**Routes de la marque** (session, rôle réseau ; un compte de boutique → `403 PERM_ROLE_REQUIRED`) :

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/v1/marketing/catalogues` | liste paginée (`page`, `perPage` ≤ 100, `sort` ∈ `updatedAt, createdAt, title`, `filter[owner|status|shop][eq]`) |
| POST | `/api/v1/marketing/catalogues` | création `{title, source{kind, ref}, format?, pageCount? (8 · 10 · 12 · 14 · 16), langs?, shopIds?, products?, pages?}` — `201` |
| GET / PUT / DELETE | `/api/v1/marketing/catalogues/{id}` | lecture, remplacement des champs présents (`pages: []` = répartition automatique), suppression `204` puis `404` |
| GET | `/api/v1/marketing/catalogues/{id}/document?shopId=&lang=` | la version mise en pages (couverture, pages, dernière page, alertes) |
| GET / PUT | `/api/v1/marketing/catalogues/{id}/brand-pages` | v1.10 (21/11/2026) — les 4 pages de la marque PROPRES à un catalogue de la marque (couverture, page 2, avant-dernière, dernière) : `common` (celles de la charte publiée qu'il lit) et `own` (les siennes, null = suit la charte). PUT : chaque page entière ou null ; rangées dans `settings.brandPages` (sans migration) ; le document les prend sans publication, les autres catalogues ne bougent pas ; la copie adaptée par une boutique les garde. Catalogue de boutique `422` (`owner`), 404 inconnu, 422 nommé. v1.11 : une couverture (charte ou propre) porte `showShop` (vrai par défaut ; faux = pas de nom de boutique sous le titre). v1.12 : chaque page de la marque porte `look` {élément: {show, font, color}} (logo, titres, textes, QR, coordonnées…) et la couverture `kickerFr` / `kickerNl` ; au document, `look` sur chaque page, les éléments de données masqués n'y partent pas. v1.15 : élément `name` de la dernière page (le nom de la boutique, masquable seul) ; vérification `fit` : 850 à l'avant-dernière en gabarit A. v1.16 : police et couleur sur chaque champ de texte (QR, coordonnées, nom, légende), couleur du logo. v1.17 : dernière page `qrTarget` (webshop / business) et `qrLabelFr` / `qrLabelNl`, élément `delivery` ; charte `colors.rule` (filets, abricot) ; dessin `bureau` |
| GET | `/api/v1/marketing/catalogue-products?shopIds=` | le webshop des boutiques : par produit, le prix de chacune, le prix le plus répandu et les boutiques qui en ont un autre |
| GET / PUT | `/api/v1/marketing/catalogue-charter` | la Charte des catalogues (v1.9 : police et couleur du titre et du sous-titre de chaque couverture) |
| PUT | `/api/v1/marketing/catalogue-shops/{id}` | v1.9 (17/11/2026) — ce qu'une boutique imprime en plus à la dernière page et que l'ERP ne porte pas : second téléphone, webshop direct (le QR), logo (médiathèque), et (v1.13, 21/11/2026, migration 054) ses horaires des fêtes FR / NL `holidayHoursFr`, `holidayHoursNl` (600 caractères, plusieurs lignes ; `DocShop.holidayHours` au document), et (v1.14, migration 055) la page « Le magasin » (gabarit C de la dernière page) : `photoMediaId`, `mapsUrl` (vide : fait de l'adresse de l'ERP), `openingHoursFr` / `openingHoursNl` (vides : ceux de l'ERP) ; `DocShop.photoUrl`, `DocShop.mapsUrl` au document ; (v1.17, migration 056) catalogue « Bureaux » : `businessUrl` (le QR de commande entreprise), `deliveryHoursFr` / `deliveryHoursNl` (`DocShop.deliveryHours`) ; `mar_catalogue_shop_contact`. L'e-mail est lu dans l'ERP. Marque seule ; 404 boutique inconnue, 422 nommé |

**Routes du dashboard magasin** (cockpit, portail Pilotage réseau — à brancher dans un second
temps, dépôt consultant_BO) : `/api/v1/integration/marketing/shops/{shopId}/…`, `shopId` =
identifiant de caisse ERP de la boutique. Jeton de service entre portails : `X-Service-Token` =
`erp_jeton_service` d'`erp_cles` (portail `commun`), comparé en temps constant — absent
`401 AUTH_TOKEN_MISSING`, faux `401 AUTH_TOKEN_INVALID` ; boutique inconnue du Marketing `404`.

| Méthode | Chemin (après `…/shops/{shopId}`) | Rôle |
|---|---|---|
| GET | `/catalogue-products` | ce que la boutique vend au webshop, à SES prix (`priceCents`, `shopPriceCents`), catégories, gammes, mises en page et nombres de pages permis (`pageCounts`) |
| GET | `/catalogue-media` | les images de la médiathèque qu'elle peut mettre à la place libre d'une page : du réseau et les siennes, ni archivées ni vidéos (paginé, `perPage` ≤ 100, `filter[name][like]`) |
| POST | `/catalogue-media` | importer une photo `{name, contentBase64}` (15/11/2026) : dans la médiathèque, rangée à SA boutique (source `cockpit`) ; une image seulement, 5 Mo au plus ; `201` créée, `200` si le même fichier y est déjà (pas de copie), `409` s'il est à une autre boutique ; `422` sinon. Pour la place libre d'une page ou la vignette d'une promotion (`offers[].mediaId`) |
| GET | `/catalogues` | ses catalogues seulement (paginé, `filter[status][eq]`) |
| POST | `/catalogues` | création `{title, source{kind: gamme | choix, ref?}, format?, pageCount?, langs?, products?, pages?}` |
| GET / PUT / DELETE | `/catalogues/{id}` | le sien seulement : celui d'une autre boutique ou de la marque → `404` |
| GET | `/catalogues/{id}/document?lang=` | sa version (ses produits, ses prix, son QR, ses coordonnées) |
| POST | `/catalogues/{id}/print-links` `{lang}` | lien signé 48 h vers la page d'impression du Marketing (`{MAR_PUBLIC_BASE_URL}/catalogue/?t=…`) — `201 {url, token, expiresAt}` ; `503` sans `MAR_SESSION_SECRET` |

Contraintes **appliquées par le serveur** pour un catalogue de boutique : produits vendus par la
boutique seulement (`422 CATALOGUE_PRODUCT_NOT_SOLD`, produit par produit) ; prix de la boutique
toujours (aucun champ de prix accepté) ; 8 à 16 pages, par 2 (9, 11, 18… : 422), dont les quatre de la charte
(couverture, page 2, avant-dernière, dernière : aucun champ pour elles, une page intérieure n'a que
`{layout, category, template, gamme, text, textNl, filler, fillerMediaId}`) ; cinq mises en page ; photos de la place libre du réseau ou d'elle seule ; source `gamme` ou `choix` ; aucune autre boutique.
Le filtrage est dans `CatalogueRepository` (`owner = 'boutique' AND shop_id = :boutique`).

**Impression** : `GET /api/v1/public/marketing/catalogue-prints/{token}` (lien signé HMAC avec
`MAR_SESSION_SECRET`, sans point, 48 h ; falsifié, expiré ou mal formé → `404`). La page
`catalogue/index.html` compose les pages et ouvre la boîte d'impression : « Enregistrer au format
PDF ». **Un seul moteur d'impression** pour les brochures et les catalogues (`src/lib/print.ts`,
polices `fontFaces` des brochures) : le PDF est celui du navigateur, comme pour les brochures.

**Écarts résiduels, signalés plutôt que contournés :**
- La **gamme** est une période de disponibilité de TFBuddy (`product-availability-periods`) :
  sans gamme active au webshop, on part d'une campagne ou de produits choisis.
- Le PDF n'est pas produit par le serveur (aucun moteur PDF côté module, comme pour les
  brochures) : le dashboard ouvre la page d'impression par son lien signé.
- `POST` sans clé d'idempotence ; pas d'`ETag` (l'écran enregistre chaque geste dans l'ordre).
- Préfixe des routes de la marque sans segment `{app}` (§3.2) ; le `401` sans identité de ces
  routes garde la forme du routeur.

Tests (`api/tests/smoke.php`, « Catalogues produits » ; TFBuddy simulé aux formes que Social lit
déjà en production) : 200 et enveloppe, 401 (sans identité ; sans jeton de service ; faux jeton),
403 (compte de boutique sur les routes de la marque), 404 (catalogue, boutique, lien), 422
(champs inconnus, source, gamme ou campagne inconnues, format, boutique inconnue, mise en page,
état, quantité, charte, gabarit, présentation sans gamme ou d'une gamme inconnue, texte trop long,
place libre inconnue, photo absente, inconnue, archivée, vidéo ou d'une autre boutique), présentations
de chaque gamme en répartition automatique (et leur liste quand la place manque), isolation d'une boutique (lecture, modification, suppression, document,
lien, liste), contraintes de la boutique, pagination et `perPage` ramené à 100, suppression
idempotente (`204` puis `404`), cache des lectures du webshop.

Couches : contrôleurs `CatalogueController` (marque) et `CatalogueIntegrationController`
(boutique, impression) → service `CatalogueService` (règles, contraintes, composition, charte,
liens signés) → dépôts `CatalogueRepository` et `WebshopCatalogueRepository` (seuls à faire du SQL).

**Les deux assistants (15 novembre 2026, `OpenAPI v1.5`).** Client : « les deux, garde les 3 gabarits, code-le »
(maquettes A1-A4 et B1-B4), puis « côté franchisé c'est un assistant : choix du catalogue, ensuite les gammes, la
présentation, validation et exportation PDF ».

- *Charte : brouillon et versions publiées* (choix appliqué, le client n'avait pas tranché). L'assistant des pages de la
  marque édite un BROUILLON (`PUT …/catalogue-charter`, enregistré tout seul) ; « Publier pour tous les catalogues »
  (`POST …/catalogue-charter/publications` → `201 {version, publishedAt, note, catalogues: {affected, printed}}`) en
  fait une version, rangée dans `mar_catalogue_charter_version` (contenu en texte, relu dans un ordre de clés fixe).
  Le document d'un catalogue lit la dernière version publiée (`charter.version`) ; « Marquer imprimé » fige la version
  du moment (`mar_catalogue.charter_version`, ou `mar_catalogue_shop.charter_version` quand une boutique imprime un
  catalogue de la marque) : un catalogue imprimé garde ses pages de la marque ; repassé « prêt », il reprend la
  dernière. `fromVersion` : revenir à une version (republiée comme nouvelle version, et reprise dans le brouillon) ;
  inconnue → 404. `GET …/publications` (paginé, `current`), `GET …/catalogue-charter/checks` (« Avant de publier » :
  `fr`, `nl`, `qr`, `fit`, `shops` ; les boutiques et ce qui manque à leur dernière page ; les catalogues concernés).
  Migration 050 : la charte d'avant devient la version 1, les catalogues déjà imprimés lui sont rattachés.
  **Changement de comportement** : un `PUT …/catalogue-charter` seul ne touche plus les catalogues (l'écran l'a
  remplacé par l'assistant ; le dashboard ne l'appelle pas).
- *Gabarits* : couverture `template` A · B · C, `visual` (`illustration | media | none` ; null = comme avant),
  `illustration` (dessin de saison, liste fermée) ; page 2 / avant-dernière `template` A · B · C (null = B avec image,
  A sinon) ; dernière page `template` A · B. Autre valeur → 422, champ nommé.
- *Boutique* (jeton de service, boutique du chemin ; les dépôts appliquent le périmètre) : `GET …/catalogues/{id}/checks`
  (points calculés à partir du document : pages vides, produits sans photo, disponibilité en pied de page, dates de
  promotion, prix — manquants ou différents au comptoir —, pages de la marque, QR, adresse, NL ; chacun `{code, level
  alerte|question|ok, title, text, page, actions, seen}`, et les pages marquées), `PUT …/checks/{code}` `{seen}`
  (idempotent, retenu dans `mar_catalogue_shop.checks_seen`), `POST …/prints` `{quantity}`, `GET|POST …/public-links`
  (jeton `{id}-{aléa}-{HMAC}` signé par `MAR_SESSION_SECRET`, rangé dans `mar_catalogue_link`, révoqué par le POST
  suivant ; page publique `GET /api/v1/public/marketing/catalogue-links/{token}?lang=` → la dernière version).
  Catalogues de la marque préparés pour la boutique (elle est dans ses boutiques des versions ; prêts ou imprimés) :
  `GET …/brand-catalogues[/{id}[/document]]`, `PUT …/{id}/reception {status: pris}` (409 s'il est adapté),
  `POST …/{id}/adaptations` (copie propriétaire boutique, ses produits seulement, `meta.removedProducts` ; 201 puis 200
  la même), `POST …/{id}/print-links` (jeton à 4 champs : la boutique de la version) et les routes checks / prints /
  public-links. Une autre boutique : 404.
- *Page publique* (`catalogue/index.html`) : `?t=` + `&mode=printer` (PDF imprimeur) · `&mode=livret` (livret A4, 2 pages
  A5 par face, ordre de pliage) · `&mode=proof` ; `&affiche=A4|A3&l=…` (affiche du magasin, QR du catalogue en ligne) ;
  `?l=` : le catalogue en ligne à feuilleter (FR | NL).
- Écart résiduel noté : réponses `Generic` dans l'OpenAPI (forme de `data` décrite ici) ; le « PDF léger » est le PDF
  sans traits de coupe du navigateur (les images ne sont pas recompressées).

Couches ajoutées : `CatalogueShopService` (vérifications, réception, adaptation, impression, liens) → dépôt
`CatalogueShopRepository` (versions de la charte, `mar_catalogue_shop`, `mar_catalogue_link`).

## 15. Le référentiel des agences en écriture (21 novembre 2026)

Le cockpit (dépôt `consultant_BO`, `marketing/src/mkt_agences.php`) écrivait `mar_agency` en SQL : son écran
« Agences » (créer, modifier, retirer), la reprise de l'agence de son ancien réglage unique, et les quatre colonnes
qu'il ajoutait lui-même (`email`, `site`, `logo_uri`, `is_default`, reprises par la migration 045). Il passe par ces
routes, avec son jeton de service. Contrat : `docs/openapi/agencies.yaml`.

- `POST …/agencies` `{name, email?, site?, logoUri?, isDefault?}` → `201` et l'agence ;
  `PATCH …/agencies/{id}` → les champs envoyés, et eux seuls ; `DELETE …/agencies/{id}` → `204`, puis `404`.
- Une seule agence par défaut (celle qui signe la note d'une campagne dont aucun canal ne désigne d'agence) : en
  désigner une retire ce rôle aux autres, dans la même transaction.
- Refus en `422 VALIDATION_FAILED`, champ nommé : nom absent, vide ou de plus de 160 caractères ; adresse qui n'en est
  pas une ; logo qui n'est pas une image embarquée (`data:image/…;base64,`) ou dépasse 700 000 caractères ;
  `isDefault` qui n'est pas un booléen ; champ inconnu. Réseau seul (`403 PERM_ROLE_REQUIRED`).
- Retrait refusé (`409 RESOURCE_STATE_INVALID`, `details` : `channels`, `interventions`) tant qu'un canal de
  campagne ou une intervention enregistrée la désigne. Le cockpit refusait déjà pour les canaux ; les interventions
  (`mar_agency_campaign`, en cascade) seraient parties avec elle sans rien dire.
- La lecture reste `GET …/agencies` (forme d'avant), qui porte aussi `email`, `site`, `logo_uri`, `is_default` et
  `channel_campaigns` : le nombre de campagnes dont un canal désigne l'agence, ce que le cockpit comptait.

Écarts au standard, notés ici : préfixe sans segment `{app}` (comme tout le module, §3.2) ; retrait physique (la
table n'a pas d'état « retirée », et le cockpit retirait de même) ; ni `ETag` / `If-Match` (un seul écran écrit ce
référentiel) ni en-tête `Location` au `201`.
