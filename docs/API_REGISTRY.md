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
| PUT | `…/campaigns/{id}/lever-targets` | tenant (écriture : marque, ou boutique sur sa campagne locale) | `{status, message}` — objectifs par levier seuls, tout statut ; idempotent |
| POST | `…/campaigns/{id}/offer-items` | tenant (même règle d'écriture) | `{status, message}` — produits du catalogue ajoutés à l'offre, tout statut ; ajout seul, idempotent |
| GET | `…/campaigns/{id}/monitor` | tenant | objet |
| GET | `…/campaigns/{id}/print` | tenant | objet (dossier d'impression) |
| GET | `…/campaigns/{id}/roi-costs` | marque | tableau |
| GET | `…/campaigns/{id}/vouchers` | tenant (résultats limités aux boutiques de l'appelant) | objet `{configured, message, can_edit, vouchers, totals, campaign_promotions}` |
| POST | `…/campaigns/{id}/vouchers` | tenant (écriture : marque, ou boutique sur sa campagne locale) | `{status, message, inserted_id}` — `inserted_id` = le code |
| PATCH | `…/campaigns/{id}/vouchers/{code}` | même règle d'écriture | `{status, message}` — bon créé pour la campagne seulement |
| PUT | `…/campaigns/{id}/vouchers/{code}` | même règle ; un franchisé ne rattache que les bons de ses boutiques | `201` rattaché, `200` déjà rattaché (idempotent), `409` suivi par une autre campagne |
| DELETE | `…/campaigns/{id}/vouchers/{code}` | même règle d'écriture | `{status, message}` — un bon créé ici est suspendu |
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
| GET | `…/webshop-vouchers?q=` | marque ; franchisé : bons de ses boutiques | objet `{configured, message, vouchers}` (200 au plus) |
| GET | `…/webshop-offices?q=` | marque | tableau |
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
| 9 | Pas de JWT propre : l'identité vient du middleware de l'ERP hôte, ou d'en-têtes de développement derrière `MAR_DEV_AUTH`. Pas de `/auth/*`, pas de rotation de refresh, pas de vérification d'`aud`. | module entier |
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
- `GET …/session` est la seule route publique, et elle est explicite dans la
  déclaration (troisième argument `true`). Elle ne rend aucune donnée métier :
  seulement si l'appelant est authentifié et sous quel rôle. Authentifié, elle
  dit aussi `dev_auth` (identité de développement, `MAR_DEV_AUTH`, ou de l'ERP) :
  un état, aucune valeur — champ ajouté, rien de retiré ni renommé.

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
