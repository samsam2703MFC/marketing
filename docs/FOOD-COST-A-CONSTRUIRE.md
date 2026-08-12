# Food cost et prix par boutique — ce qu'il reste à construire

Mémo à l'attention du développeur de l'ERP. Le module marketing a besoin de
deux choses pour son étape « Pricing » — simuler un nouveau prix de vente et
calculer le volume supplémentaire nécessaire pour compenser la marge perdue :

1. le **coût matière unitaire d'un produit** ;
2. le **prix de vente d'un produit dans une boutique donnée**.

Le second est réglé depuis : `GET /api/v1/shops/{shop}/products/price-list/document`
existe et le module l'appelle — voir §4. Le premier, le coût matière, reste à
construire, et c'est l'essentiel de ce mémo. Il dit ce qui est déjà en base
(vérifié, pas supposé), ce qui manque, et ce qu'il faut exposer.

---

## 1. Ce que le module sait déjà faire seul

Le module lit directement la base de l'ERP. Il n'a **rien à demander** pour :

| Donnée | Source | État |
|---|---|---|
| Prix de vente **réseau** | `product.suggested_sale_price` | déjà repris |
| Taux de TVA du produit | `product.tax_val_perc` | à reprendre, trivial |
| Prix réellement pratiqué (moyen, min, max) | `transaction_product.unit_gross_price` | à agréger, trivial |
| Remises consenties | `transaction_product.item_discount_value` | disponible |
| Quantités vendues par boutique × produit | `transaction` × `transaction_product` | déjà en place |

Ces points ne demandent aucun travail de votre côté.

Attention à la nuance sur le prix : `suggested_sale_price` est un prix
**suggéré au réseau**. Ce n'est pas nécessairement celui qu'une boutique
pratique — voir §4.

---

## 2. Ce qui manque : le coût matière d'un produit

La chaîne existe en base et a été vérifiée sur `atelierby_db` :

```
product.id_recipe
   → product_recipe            (id, name, is_subrecipe, yield_quantity, id_unit)
   → flattened_recipe_ingredient (id_recipe, id_material, quantity)
   → material                  (id, name, id_category, id_unit,
                                is_part_of_package, waste_amount_perc,
                                source_type, kind)
```

Deux bonnes nouvelles : `flattened_recipe_ingredient` est **déjà aplatie** — les
sous-recettes sont résolues, aucune récursion à écrire — et `material` porte son
taux de perte.

**Le blocage** : `material` ne porte **aucun prix**. C'est la pièce manquante,
et sans elle aucune marge ne se calcule.

La famille `material_*` compte une trentaine de tables. Deux retiennent
l'attention, sans que nous ayons ouvert leurs colonnes — c'est à vous de
confirmer :

| Candidate | Ce qu'elle porterait | Réponse à la §5 |
|---|---|---|
| `material_pack` | conditionnement et prix de référence | coût **standard** |
| `material_order_item` | lignes de commande fournisseur | **dernier prix d'achat** |

Si les deux portent un prix, la question du coût standard contre le dernier
prix d'achat se tranche entre elles — voir §5.

---

## 3. Ce qu'il faut construire

### Option A — un endpoint (recommandée)

```
GET /api/v1/products/food-cost?product_ids=101,102,103
```

```json
{
  "data": [
    {
      "product_id": 101,
      "material_cost": 0.4820,
      "currency": "EUR",
      "unit": "piece",
      "source": "standard",
      "computed_at": "2026-08-08T17:40:00+02:00",
      "incomplete": false
    },
    {
      "product_id": 102,
      "material_cost": null,
      "incomplete": true,
      "reason": "matière 5512 sans prix d'achat"
    }
  ]
}
```

Règles attendues :

- **Hors taxes.** Le module fait tous ses calculs de marge en HT.
- **Par pièce vendue**, pas par recette : diviser par `product_recipe.yield_quantity`.
- **Pertes incluses** : `material.waste_amount_perc` gonfle la quantité
  réellement consommée. Précisez dans la réponse si vous les incluez ou non —
  les deux se défendent, mais il faut le savoir.
- **Conversion d'unités** : `flattened_recipe_ingredient.quantity` est exprimée
  dans `material.id_unit`, le prix d'achat probablement dans une autre. C'est
  la principale raison pour laquelle ce calcul doit vivre chez vous et non chez
  nous : dupliquer une table de conversion, c'est se garantir deux résultats
  différents pour le même produit.
- **`incomplete: true` plutôt qu'un zéro.** Un produit dont une matière n'a pas
  de prix doit être signalé, pas chiffré à 0. Le module l'affichera comme
  « food cost manquant » et désactivera la simulation pour cette ligne. Un zéro
  silencieux produirait une marge de 100 % et une recommandation de prix fausse.
- **Par lot.** Un appel pour N produits, jamais un appel par produit : l'écran
  en affiche jusqu'à plusieurs dizaines d'un coup.

### Option B — nous documenter les tables

Si vous préférez que nous calculions nous-mêmes en SQL, il nous faut :

1. La **table qui porte le prix d'achat d'une matière**, et sa clé vers
   `material`.
2. La règle de **conversion d'unités** entre la quantité de recette et l'unité
   du prix.
3. Le traitement attendu de `waste_amount_perc`.

C'est faisable, mais cela déplace chez nous une règle métier qui est la vôtre.
À la première évolution de votre côté, les deux calculs divergeront sans que
personne ne s'en aperçoive.

---

## 4. Le prix de vente par boutique — répondu

> **Mise à jour.** Cette section demandait un endpoint. Il existe :
>
> ```
> GET /api/v1/shops/{shop}/products/price-list/document
> ```
>
> Le module l'appelle désormais pour les boutiques du périmètre, et se rabat
> sur le prix catalogue réseau quand il ne répond pas. Deux points restent à
> confirmer de votre côté, et ils sont écrits ici parce qu'ils changent un
> chiffre affiché :
>
> 1. **Le prix rendu est-il TTC ?** Le module calcule ses marges en HT et
>    affiche en TTC. Il lit `includes_tax` si la réponse le porte ; sinon il
>    suppose TTC, ce qui est le bon défaut pour de la vente en boutique mais
>    reste une supposition.
> 2. **La route rend-elle du JSON ?** Son nom — `document` — laisse la place à
>    un PDF. Dans ce cas il nous faut une variante JSON : un tarif imprimé ne
>    se relit pas.
>
> La suite de la section reste valable : elle décrit ce que le module fait des
> prix une fois lus, et ce qu'il ne peut pas déduire seul.

## 4 bis. Pourquoi le prix par boutique

`product.suggested_sale_price` est un prix de référence réseau. Une boutique
peut vendre à un autre prix, et l'écran doit le montrer : afficher un prix
unique alors que le réseau en pratique trois, c'est simuler une baisse depuis
un prix que personne n'applique.

Nous savons lire le prix **réellement encaissé** (`transaction_product.
unit_gross_price`) — moyenne, min et max par boutique. Mais un prix constaté
n'est pas un prix affiché : il porte les remises, les portions, les opérations
passées. Pour une simulation tarifaire, il faut le **prix de vente en vigueur**,
que la route ci-dessus rend boutique par boutique.

Ce que nous en faisons : quand les boutiques du périmètre ne s'accordent pas,
c'est le prix **le plus répandu** qui sert de départ, et l'écart reste affiché
(« 2 prix boutique »). Une moyenne inventerait un prix que personne ne pratique.

La forme ci-dessous reste celle que nous appellerions idéalement — un appel
pour N produits × M boutiques plutôt qu'un appel par boutique :

```
GET /api/v1/products/prices?product_ids=101,102&shop_ids=2,4,10
```

```json
{
  "data": [
    { "product_id": 101, "shop_id": 2,  "price": 2.90, "tax_rate": 6.0,
      "currency": "EUR", "includes_tax": true, "source": "shop" },
    { "product_id": 101, "shop_id": 4,  "price": 3.10, "tax_rate": 6.0,
      "currency": "EUR", "includes_tax": true, "source": "shop" },
    { "product_id": 101, "shop_id": 10, "price": 2.90, "tax_rate": 6.0,
      "currency": "EUR", "includes_tax": true, "source": "network" }
  ]
}
```

Règles attendues :

- **`includes_tax`** explicite. Le module affiche en TTC et calcule en HT ; il
  ne doit pas avoir à deviner ce qu'il reçoit.
- **`source`** dit si le prix vient de la boutique ou du réseau par défaut.
  C'est ce qui permet d'écrire « 3 boutiques sur 5 appliquent le prix réseau »
  plutôt que de laisser croire à une dispersion qui n'existe pas.
- **Par lot**, produits × boutiques en un appel. Cinq boutiques et quarante
  produits ne doivent pas faire deux cents requêtes. En attendant, le module
  appelle `price-list/document` une fois par boutique du périmètre — cinq
  appels pour cinq boutiques, ce qui tient tant que le réseau reste petit.
- Si aucune boutique ne fixe son prix aujourd'hui, dites-le : le module
  travaillera au niveau réseau et la structure restera prête pour le jour où
  ce ne sera plus vrai.

---

## 5. Question à trancher

**Coût standard ou dernier prix d'achat constaté ?**

Les deux répondent à des questions différentes :

- le **coût standard** (fiche technique) donne une marge stable, comparable
  d'un mois sur l'autre — c'est ce qu'on veut pour arbitrer un prix ;
- le **dernier prix d'achat** donne la marge réelle d'aujourd'hui — c'est ce
  qu'on veut pour constater.

Si les deux existent, l'idéal est un paramètre `?basis=standard|last_purchase`,
et que la réponse dise lequel a servi (`"source"`). Si un seul existe, dites-le
simplement : le module affichera lequel.

---

## 6. Ce à quoi ça sert, concrètement

L'écran répond à une question : *« si je descends ce produit à 2,80 €, combien
de pièces en plus faut-il vendre pour ne pas y perdre ? »*

```
Prix de vente HT = Prix TTC / (1 + TVA)
Marge unitaire M = Prix HT − Food cost HT
Volume d'équilibre Q1 = Q0 × M0 / M1
```

`M1` est la marge au prix proposé. Si le food cost est faux de 10 %, `Q1` l'est
davantage — l'erreur est amplifiée par le rapport. D'où l'insistance sur
`incomplete` plutôt qu'un zéro : mieux vaut une ligne qui dit qu'elle ne sait
pas qu'une ligne qui se trompe avec assurance.

---

## 7. Hors périmètre

Le module `food-cost` transmis par ailleurs (`FoodCost.php`, `food-cost.js`,
`mac_*`) calcule un food cost **par boutique et par période**
(`coût matière ÷ CA`), agrégé, depuis l'API métier. Il ne répond pas à ce
besoin-ci : appliqué au Pricing, il donnerait à tous les produits le même taux
de marge, et la simulation — qui sert justement à les comparer entre eux — ne
dirait plus rien.

Ses bandes de couleur (`mac_kpi_threshold`, métrique `gross_margin`) restent en
revanche la bonne référence pour colorer les marges à l'écran, et c'est elles
que nous reprendrons plutôt que d'inventer une échelle.
