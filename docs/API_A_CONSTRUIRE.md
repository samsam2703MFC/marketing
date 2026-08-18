# Passer le module marketing en tout-API

Objectif : plus aucune lecture directe de la base de l'ERP depuis ce module
(`API_STANDARD.md` §1.1). Ce document liste **ce qu'il lit aujourd'hui en SQL**,
donc ce dont il a besoin en HTTP, et **ce qu'il peut exposer** en retour.

État au 17 août 2026.

---

## 0. Ce qui n'est pas un problème

À vérifier avant de chercher des coupables ailleurs :

- **Le front ne parle jamais à la base.** Il n'appelle que l'API du module, par
  un client unique (`src/lib/api/`). Aucun `fetch` brut dans un composant.
- **Il n'y a ni mockup ni jeu de démonstration.** `src/data/` est vide, aucun
  repli « demo » dans le client HTTP. Les fichiers de `db/seeds/` ne peuplent que
  les **référentiels du module** (`mar_lever`, `mar_channel`, `mar_format`,
  `mar_tone`, `mar_campaign_status`…) : ce sont ses propres listes de
  configuration, pas une copie de données ERP. Aucun magasin, client, produit ou
  vente n'y est inventé.
- **Les tables de l'ERP ne sont jamais écrites.** Aucune migration, aucun test,
  aucun script ne les crée, ne les modifie ni ne les supprime.

Le seul écart au §1.1 est donc la **lecture**. Il portait sur huit tables ; les
deux tables de redevances sont sorties avec la gestion des redevances (§1.4), il
en reste six.

---

## 1. Ce que le module lit dans la base de l'ERP — à remplacer par des API

Chaque entrée dit : ce qui est lu, pourquoi, et la forme d'endpoint attendue.
Les chemins proposés suivent le §2 du standard (`/api/v1/{app}/{domaine}/{ressource}`)
avec `{app} = integration` — un module serveur qui consomme l'ERP est un
consommateur machine, pas un utilisateur.

### 1.1 Boutiques — `shops` *(ex-`franchisee_shop`)*

- **Lu par** `ErpSyncRepository` (alimente `mar_shop`), et indirectement par tout
  l'écran réseau.
- **Champs utilisés** : id, code, nom, ville, marque/enseigne, actif.
- **Besoin** : `GET /api/v1/integration/referentiels/shops?page&perPage&filter[brandId]`
- **Volume** : quelques dizaines. Une page suffit.

### 1.2 Produits, catégories, saisons — `product`, `product_category`, `product_availability_period`

- **Lu par** `ErpSyncRepository` (alimente `mar_offer_item` : le catalogue dans
  lequel une campagne compose son offre) et `PriceListRepository` en repli.
- **Champs utilisés** : id, référence/SKU, nom, catégorie, prix conseillé,
  période de disponibilité, actif. **Photo** — attendue, jamais trouvée : c'est
  ce qui manque au dossier d'impression.
- **Besoin** :
  - `GET /api/v1/integration/catalogue/products?page&perPage&filter[categoryId]&filter[isActive]`
    → doit rendre `imageUrl` (R2 absolu, §13) ;
  - `GET /api/v1/integration/catalogue/product-categories` ;
  - `GET /api/v1/integration/catalogue/product-seasons` (ou `availabilityPeriods` inclus dans le produit).
- **Volume** : quelques centaines. Pagination réelle nécessaire.

### 1.3 Ventes — `transaction` + `transaction_product`

- **Lu par** `SalesRepository` : quantités vendues par produit, par boutique et
  par période. C'est l'historique N-1 sur lequel s'appuient les objectifs de
  campagne et le calcul du ROI.
- **Le point le plus lourd du chantier.** Aujourd'hui une jointure agrégée en
  SQL ; en HTTP il faut une agrégation **côté ERP**, sinon le module devrait
  rapatrier des millions de lignes de ticket.
- **Besoin** :
  `GET /api/v1/integration/ventes/quantities?filter[shopId][in]=…&filter[date][gte]=…&filter[date][lt]=…&groupBy=product,shop,month`
  → `[{ shopId, productId, month, quantity, revenueCents }]`
- **Sans cet endpoint agrégé, le passage en API n'est pas faisable** pour cet
  écran : c'est le seul point où la règle et la physique se rencontrent.

### 1.4 Redevances — **retiré**

La gestion des redevances a été retirée du module : plus d'écran, plus de
routes, plus de lecture de `royalty_invoice`. La migration 034 a fait le ménage
en base — taux, colonnes de calcul et origines de mouvement partent là où rien
n'a été saisi ; le détail est au §5 du registre.

Le fonds garde ses écritures — y compris celles qui ont pu être produites avant
le retrait, qui sont des lignes de grand livre comme les autres et n'avaient
aucune raison de disparaître avec l'outil qui les avait créées.

Rien à construire ici, donc, tant que le sujet ne revient pas.

### 1.5 Clients et secteurs B2B — `client`, `b2b_client_type`, `b2b_client_interest_connection`

- **Lu par** `ErpSyncRepository` : prospects B2B, secteur d'activité, boutique
  de rattachement (`preferred_shop_id`, qui sert au ciblage par magasin).
- **Besoin** :
  - `GET /api/v1/integration/crm/customers?filter[preferredShopId][in]=…&filter[isB2b]=true&page&perPage`
  - `GET /api/v1/integration/crm/customer-types`
- **Volume** : le plus gros du lot. Pagination obligatoire, et un filtre
  d'incrément (`filter[updatedAt][gte]`) pour ne pas tout relire à chaque reprise.

### 1.6 Tarifs par boutique — **déjà en API** ✅

`GET {base}/api/v1/shops/{shop}/products/price-list/document`, consommé par
`PriceListRepository`. C'est le seul accès ERP déjà conforme au §1.1 — il sert de
modèle aux autres. Reste à renseigner `MAR_ERP_API_BASE` sur le serveur, sans
quoi le module retombe sur le catalogue.

### 1.7 Recettes et food cost — endpoint connu, jamais vérifié

`GET /api/v1/recipes/{id}` — demandé, jamais joint depuis l'environnement de
développement (IP hors allowlist). Alimenterait le coût matière d'une offre.

---

## 2. Ce que le module peut exposer — API que je peux construire

Le module possède ses propres données (`mar_*`) et les sert déjà par 54 routes
(`API_REGISTRY.md`). Ce qui manque, en API que ce dépôt peut écrire seul :

### 2.1 La vitrine — nouvelle, et attendue

La colonne `show_web_shop` existe (migration 032) mais **rien ne la lit**. La
boutique en ligne a besoin de :

```
GET /api/v1/public/marketing/campaigns
    → campagnes publiées (showWebShop = true), dans leur période, statut actif
    → nom, dates, visuel R2, couleurs, offres et prix remisés, boutiques concernées
```

Publique au sens du §2.3 : aucune donnée interne (budget, marge, objectifs,
prospects) n'en sort. C'est la seule route de ce dépôt qui a vocation à l'être, et
elle se déclare explicitement.

### 2.2 Le catalogue d'impression — existe, à normaliser

`GET …/campaigns/{id}/print` rend déjà tout le dossier d'impression. En `v2` il
devient `GET /api/v1/erp/marketing/campaigns/{id}/print` avec enveloppe et
`camelCase`.

### 2.3 Les 54 routes existantes, en `v2`

Le préfixe actuel `/api/v1/marketing/…` est à une chose près conforme : il lui
manque le segment `{app}`. La bascule est mécanique :

```
/api/v1/marketing/campaigns        →  /api/v1/erp/marketing/campaigns
                                      /api/v1/franchise/marketing/campaigns
```

`marketing` devient le **domaine**, ce qu'il est réellement. Les deux `{app}`
partagent le service et diffèrent par la projection et les droits (§2.3) — ce qui
correspond exactement aux deux rôles déjà en place (réseau / franchisé).

S'y ajoutent l'enveloppe `{success, data, meta}`, le catalogue de codes d'erreur,
le `camelCase`, la pagination des ~25 collections, et l'OpenAPI. `v1` reste servi
pendant la fenêtre de dépréciation de trois mois (§14).

---

## 3. Correspondance avec le swagger TFBuddy

Le swagger est arrivé dans le dépôt (`/swagger`, OpenAPI 3.0, **924 chemins**,
serveur `https://test.tfbuddy.com`). Six des sept besoins ont déjà leur endpoint.

**Réserve valable pour tout ce tableau** : le swagger est engendré depuis
l'enregistrement des routes, et le dit lui-même — « Request, authorization and
response contracts are not inferred by coverage generation ». Sur 1 229
opérations, 454 portent un contrat détaillé ; les autres n'ont qu'une réponse
« The data ». **Les chemins sont donc sûrs, les charges utiles ne le sont pas.**
Il faudra un appel réel par endpoint avant d'écrire le mapping — c'est la
vérification qui a manqué la seule fois où un mapping a été écrit sans elle.

| Besoin | Endpoint TFBuddy | Contrat |
|---|---|---|
| §1.1 Boutiques | `GET /api/v1/shops`, `GET /api/v1/shops/{id}` | à confirmer |
| §1.2 Produits | `GET /api/v1/products`, `GET /api/v1/products/{id}` | à confirmer |
| §1.2 Catégories | `GET /api/v1/product-categories` (+ `/used`) | à confirmer |
| §1.2 Saisons | `GET /api/v1/product-availability-periods`, `…/{id}/products`, `GET /api/v1/products/{id}/availability-periods` | à confirmer |
| §1.4 Redevances | *retiré du module* | — |
| §1.5 Clients | `GET /api/v1/clients?limit=&offset=&type=&vat_id=` | **documenté** (`ClientRecord`) |
| §1.6 Tarifs | `GET /api/v1/shops/{shop}/products/price-list/document` | déjà consommé |
| §1.7 Recettes | `GET /api/v1/franchise/{shop}/product-recipes/calculation`, `…/product-recipe/{id}/calculation` | à confirmer |
| §1.3 **Ventes par produit** | *rien de direct* — voir ci-dessous | — |

### 3.1 Un gain immédiat, déjà lisible dans le swagger

- **Clients.** `ClientRecord` porte `id_main_shop` et `is_b2b` — exactement le
  rattachement boutique et le marqueur professionnel dont le ciblage a besoin,
  sans avoir à connaître le schéma.

### 3.2 Le seul vrai trou : les ventes par produit

Le swagger expose des ventes **agrégées autrement** que ce dont le module a
besoin :

- `/api/v1/consultant/shops/monthly-sales?from=&to=` — par boutique et par mois ;
- `/api/v1/consultant/shops/category-sales` — par catégorie ;
- `/api/v1/shops/{id}/statistics/sales/product-category-groups` — par groupe ;
- `/api/v1/shops/{id}/transactions`, `/api/v1/transactions/{id}/products` — le
  détail ticket par ticket.

Le module a besoin de **quantités par produit, par boutique et par mois** : c'est
l'historique N-1 sur lequel se calculent les objectifs de campagne. Aucun de ces
endpoints ne le rend. Reconstituer l'agrégat en parcourant les transactions
demanderait de rapatrier tous les tickets d'une année — irréaliste.

Il manque donc **un** endpoint côté ERP, et un seul :

```
GET /api/v1/consultant/shops/product-sales?from=2025-01-01&to=2025-12-31
    &shopIds=3,7,12&groupBy=product,shop,month
→ [{ shopId, productId, month, quantity, revenueCents }]
```

C'est la seule dépendance qui empêche le module d'être en tout-API. Tout le
reste est faisable avec l'existant.

---

## 4. Ordre de travail proposé

| Rang | Chantier | Dépend de |
|---|---|---|
| **fait** | **Client HTTP ERP mutualisé** (`Support\ErpClient`) — un seul point d'appel : adresse en configuration, jeton, `X-Request-Id`, délai, déballage d'enveloppe, échecs traduits en messages qui disent quoi regarder. Extrait de l'appel des tarifs, pas écrit à côté. | — |
| **fait** | **Route vitrine publique** (§2.1) — `GET /api/v1/public/marketing/campaigns`, au format du standard. | — |
| 4 | **Boutiques et catalogue** (§1.1, §1.2) — la reprise ERP devient un client HTTP | un appel réel par endpoint |
| 5 | **Clients B2B** (§1.5) — `limit`/`offset` existent ; reste à savoir s'il y a un filtre incrémental, sinon la reprise relit tout | un appel réel |
| 6 | **Ventes par produit** (§3.2) | un endpoint à créer côté ERP |
| 7 | **Bascule `v2`** des 54 routes | décision |

Les rangs 1 à 5 ne demandent rien à personne d'autre que des appels de
vérification. Le rang 6 demande un développement côté TFBuddy. Le rang 7 est une
décision de calendrier, pas une difficulté technique.
