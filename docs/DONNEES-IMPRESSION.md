# Données disponibles pour un support imprimé

Inventaire de ce que le module peut fournir à un gabarit d'impression : les
champs, leur source, leur type, et ce qui manque encore. Écrit pour composer un
template sans avoir à ouvrir la base.

Chaque champ porte son état :

| État | Ce que ça veut dire |
|---|---|
| **en base** | La donnée existe et le module la rend déjà. |
| **dormant** | La colonne existe, rien ne l'écrit ni ne la lit. |
| **à construire** | Rien en base. Ce qu'il faudrait ajouter est décrit. |

---

## 1. Géométrie d'impression

Un seul format d'impression est câblé aujourd'hui, dans `api/src/Support/ImageStore.php` :

| Grandeur | Valeur |
|---|---|
| Format fini | 100 × 150 mm |
| Résolution | 300 dpi |
| Fond perdu | 3 mm sur chaque bord |
| **Pixels avec fond perdu** | **1 252 × 1 843 px** (106 × 156 mm) |
| Seuil de netteté | en deçà de 1 182 × 1 772 px, l'image est signalée comme trop petite |

Toute image envoyée par l'assistant est **réduite à ce format** à l'écriture, et
jamais agrandie. La réponse de l'envoi dit ce qui s'est passé :

```json
{ "path": "uploads/7339ce…png", "bytes": 184320,
  "width": 1252, "height": 1843,
  "original_width": 3000, "original_height": 4416,
  "resized": true, "below_print": false }
```

`below_print: true` = l'image tient sous le seuil de netteté ; l'écran le dit,
il ne bloque pas.

Les autres formats sont **écran**, et vivent en base (`mar_format`) :

| Code | Nom | Pixels |
|---|---|---|
| `fb_header` | Header Facebook | 820 × 312 |
| `landing` | Landing page | 800 × 800 |
| `ig_post` | Post Instagram | 1080 × 1080 |
| `fb_post` | Post Facebook | 1200 × 630 |
| `pwa` | PWA | 1080 × 1920 |

**Il n'existe aucune ligne de format imprimé dans `mar_format`.** Un A5, un A4,
un chevalet de comptoir ou une affiche vitrine s'y ajoutent en une ligne chacun,
sans code — c'est une table de référentiel.

---

## 2. La campagne — *en base*

Table `mar_campaign`, rendue par `GET /api/v1/marketing/campaigns/{id}`.

| Champ | Type | Pour le gabarit |
|---|---|---|
| `name` | texte 200 | Titre de l'opération |
| `starts_on` / `ends_on` | date | « Du 2 au 31 janvier 2026 » |
| `type_label` | texte | « Fêtes (Noël, Épiphanie…) » |
| `lever_label` | texte | « Trafic », « Panier » |
| `lever_color_hex` | `#RRGGBB` | Couleur du levier — voir §7 |
| `tone` | code | Ton de la prise de parole |
| `scope` | `RESEAU` \| `LOCALE` | Décide si le support porte une boutique |
| `client_target` | `b2c` \| `b2b` \| `mixte` | |
| `status_label`, `status_text_hex`, `status_bg_rgba` | | Pastille d'état |
| `brand_name`, `logo_url` | | Marque et logotype |

---

## 3. Le visuel de campagne — *en base*

Table `mar_campaign_asset`, un visuel maître par campagne.

| Champ | Type | Pour le gabarit |
|---|---|---|
| `file_url` | chemin | `/marketing/uploads/….png` |
| `focal_point_y` | 0–100 | Point de recoupe vertical, en % de la hauteur |
| `fit` | `cover` \| `contain` | Remplir le cadre en rognant, ou tenir entier avec ses marges |

`focal_point_y` n'a de sens qu'en `cover` : c'est la ligne que la recoupe doit
garder au centre. En `contain`, rien n'est rogné et le point n'a plus d'objet.

---

## 4. L'offre — *en base*

Table `mar_campaign_offer` (une par campagne).

| Champ | Type | Pour le gabarit |
|---|---|---|
| `title` | texte 200 | « Épiphanie 2026 » |
| `mechanic_text` | texte 400 | Phrase de mécanique, libre |
| `starts_on` / `ends_on` | date | Fenêtre de l'offre, distincte de la campagne |
| `hour_from` / `hour_to` | heure | « de 15 h à 18 h » |
| `weekdays_mask` | bitmask 7 bits | Jours d'application |
| `scope_label` | texte 200 | « Dans les boutiques participantes » |
| `max_qty_per_ticket` | entier | « 2 par ticket » — vide = sans limite |
| `is_cumulative` | booléen | « Non cumulable avec d'autres promotions » |

**Dormant** : `price_label`, `discount_label`, `image_url` sur cette table.
Trois colonnes héritées du handoff d'origine, que rien n'écrit ni ne lit. Elles
sont libres si le gabarit veut un prix d'accroche rédigé à la main (« 3 pour
10 € ») plutôt que calculé.

---

## 5. Les produits de l'offre — *en base*

Table `mar_campaign_offer_item`, jointe au catalogue `mar_offer_item`.

| Champ | Source | Pour le gabarit |
|---|---|---|
| `label` | ligne d'offre | Nom affiché, corrigeable sans toucher au catalogue |
| `name`, `detail` | catalogue | Nom et famille — « Galette Frangipane », « Galette » |
| `sku_ref` | catalogue | `erp-101` |
| `baseline_price` | ligne, sinon catalogue | **Prix barré**, TTC |
| `mechanic_type` | ligne | `PERCENT`, `CROSSED_PRICE`, `BUY_X_GET_Y`, `BUNDLE_FIXED`, `FREE_DELIVERY` |
| `discount_pct` | ligne | −20 % |
| `fixed_price` | ligne | Prix barré / prix de formule, TTC |
| `buy_qty` / `get_qty` | ligne | « 2 achetés, 1 offert » |
| `margin_pct` | ligne, sinon campagne | Taux de marge — **usage interne, jamais imprimé** |
| `target_pieces` | ligne | Objectif réseau — **interne** |

Le **prix après promotion** n'est pas stocké : il se calcule. La règle, telle
que l'étape « Prix » l'applique :

```
PERCENT        prix après = baseline × (1 − discount_pct/100)
CROSSED_PRICE  prix après = fixed_price
BUNDLE_FIXED   prix après = fixed_price
BUY_X_GET_Y    prix moyen à la pièce = baseline × buy_qty / (buy_qty + get_qty)
FREE_DELIVERY  prix inchangé
```

Le prix de départ vient du **tarif de la boutique** lu sur l'ERP quand il répond
(`GET /api/v1/shops/{shop}/products/price-list/document`), sinon du **prix
catalogue réseau**. La réponse dit laquelle des deux a servi — voir
`docs/DEPLOIEMENT-SERVEUR.md`.

---

## 6. Les boutiques — *partiel*

Table `mar_shop` : `name`, `city`, `code`, `erp_shop_id`, `gmb_place_id`,
`opened_at`.

**Manquant pour un imprimé** : adresse, code postal, téléphone, horaires
d'ouverture. Un dépliant qui ne dit pas où aller ne sert à rien, et rien de tout
cela n'est repris de l'ERP aujourd'hui. La reprise sait déjà lire
`franchisee_shop` : ajouter ces colonnes à la découverte est un travail court,
à condition de savoir comment elles s'appellent chez vous.

---

## 7. Les couleurs — *partiel*

Existant, et directement utilisable :

| Source | Champ | Exemple |
|---|---|---|
| Levier | `lever_color_hex` | `#6366f1` Trafic · `#ec4899` Récurrence · `#f59e0b` Expérience · `#10b981` Food-Cost · `#4A6D8C` Panier |
| État | `status_text_hex` / `status_bg_rgba` | `#8D1D2C` sur `rgba(141,29,44,.10)` |

**À construire — la palette propre à la campagne.** Une campagne n'a pas ses
couleurs : elle emprunte celle de son levier, qui dit un objectif commercial et
non une identité visuelle. Deux campagnes « Trafic » sortiraient donc du même
violet, et une opération Épiphanie ne peut pas être bordeaux et or.

Ce que j'ajouterais, décidé à la construction de la campagne et rendu au
gabarit :

```
mar_campaign.color_primary_hex     #8D1D2C   couleur dominante
mar_campaign.color_secondary_hex   #E8D9C0   aplats, fonds
mar_campaign.color_accent_hex      #B0821A   prix, pastilles, appels
mar_campaign.color_ink_hex         #241C1A   texte sur les aplats clairs
```

Quatre valeurs plutôt qu'une : un imprimé a besoin d'un fond, d'un texte lisible
dessus et d'un accent pour le prix. Une seule couleur obligerait le gabarit à en
dériver trois, et deux gabarits en dériveraient deux résultats différents.

---

## 8. Les photos produits — *dormant*

`mar_offer_item.image_url` **existe** dans le catalogue. Rien ne l'écrit — la
reprise ERP ne lit pas de colonne d'image — et rien ne la lit : l'étape « Offre »
affiche des illustrations locales choisies par famille et par saison
(`public/img/…`), pas la photo du produit.

Il manque donc les deux bouts :

1. **La source.** Si la table `product` de l'ERP porte une image, la reprise
   peut la découvrir comme elle découvre les autres colonnes — dites-moi son
   nom, ou je l'ajoute à la liste des candidats (`image`, `photo`, `picture`,
   `image_url`, `img`, `thumbnail`). À défaut, un envoi manuel par produit,
   comme le visuel de campagne.
2. **Les options d'impression**, à décider par produit et par support :

```
afficher la photo          oui / non
cadrage                    remplir (recoupé) / entier (avec marges)
point focal                0–100, comme le visuel de campagne
afficher le prix barré     oui / non
afficher le prix après     oui / non
afficher la mécanique      oui / non   (« 2+1 offert »)
```

---

## 9. Deux sorties : un fichier général, un fichier par franchise

Un support de campagne se décline en deux jeux, et ils ne portent pas la même
chose :

| Sortie | Contenu | Ce qu'elle ne porte pas |
|---|---|---|
| **Général** — un fichier | Campagne, visuel, offre, produits, prix réseau | Ni boutique, ni objectif |
| **Par franchise** — un fichier par boutique | Le général, plus l'identité de la boutique et **sa page objectif** | — |

La page objectif n'existe que dans la version boutique : elle s'adresse à
l'équipe, pas au client. Elle dispose de tout ce que l'étape « Objectifs de
vente » a posé, jusqu'au détail par produit :

| Donnée | Source | Exemple |
|---|---|---|
| Objectif total de la boutique | `mar_campaign_shop.target_pieces` | 4 050 pièces |
| Objectif par catégorie | somme des produits de la famille | Cougnou 2 100 |
| Objectif par produit | `mar_campaign_shop_item_target` | Cougnou - Sucre 1 100 |
| Vendu sur la période d'analyse | caisse (`transaction` × `transaction_product`) | 900 pièces |
| Effort demandé | objectif ÷ vendu − 1 | +22 % |
| Part du réseau | objectif boutique ÷ objectif réseau | 37 % |
| Seuil du challenge | `challenge_trigger_pct` de la boutique, sinon le général | 100 % = 4 050 pièces |
| Récompenses | `mar_campaign_challenge_prize` | 1er : 1 000 € + trophée |

Un produit sans objectif propre garde son historique dans le total — c'est la
règle de l'écran, et la page imprimée doit dire la même chose que lui.

### La route

Aujourd'hui ces données se récupèrent en trois appels (campagne, brouillon,
tarifs). Pour un gabarit, une route unique évite d'avoir à les recoller — et le
même appel sert les deux sorties, selon qu'on lui donne une boutique ou non :

```
GET /api/v1/marketing/campaigns/{id}/print              → le fichier général
GET /api/v1/marketing/campaigns/{id}/print?shop_id=2    → le fichier de Corbais
GET /api/v1/marketing/campaigns/{id}/print?shop_id=all  → un objet par boutique,
                                                          pour générer la série
```

```json
{
  "campaign": {
    "name": "Épiphanie 2026",
    "starts_on": "2026-01-02", "ends_on": "2026-01-31",
    "type_label": "Fêtes (Noël, Épiphanie…)",
    "tone": "chaleureux",
    "colors": { "primary": "#8D1D2C", "secondary": "#E8D9C0",
                "accent": "#B0821A", "ink": "#241C1A" }
  },
  "brand": { "name": "L'Atelier By", "logo_url": "/marketing/img/logo.png" },
  "visual": { "file_url": "/marketing/uploads/7339ce.png",
              "fit": "cover", "focal_point_y": 42 },
  "offer": {
    "title": "Galettes des rois",
    "mechanic_text": "La deuxième à moitié prix",
    "starts_on": "2026-01-02", "ends_on": "2026-01-31",
    "hour_from": null, "hour_to": null,
    "max_qty_per_ticket": 2, "is_cumulative": false
  },
  "products": [
    {
      "label": "Galette Frangipane",
      "family": "Galette",
      "sku_ref": "erp-102",
      "image_url": null,
      "price_before": 19.90,
      "price_after": 15.92,
      "mechanic": { "type": "PERCENT", "value": 20, "text": "−20 %" },
      "options": { "show_photo": true, "show_price_before": true,
                   "show_price_after": true, "show_mechanic": true }
    }
  ],
  "shop": { "name": "Atelier by Berlo - Corbais", "city": "Corbais",
            "address": null, "phone": null, "opening_hours": null },
  "objective": {
    "total_pieces": 4050,
    "sold_pieces": 3591,
    "effort_pct": 13,
    "network_share_pct": 37,
    "challenge": { "trigger_pct": 100, "bar_pieces": 4050, "missing_pieces": 459,
                   "prizes": ["1 000 € + trophée", null, "300 €"] },
    "by_category": [
      { "name": "Cougnou", "sold": 1900, "target": 2100,
        "products": [
          { "name": "Cougnou - Sucre", "sold": 900, "target": 1100 },
          { "name": "Cougnou - Sucre & Chocolat", "sold": 600, "target": 600 }
        ] }
    ]
  },
  "formats": [ { "code": "print_a5", "width_px": 1252, "height_px": 1843,
                 "bleed_mm": 3, "dpi": 300 } ],
  "legal": { "period_text": "Du 2 au 31 janvier 2026",
             "conditions_text": "Non cumulable · 2 par ticket · dans les boutiques participantes" }
}
```

Le bloc `objective` n'apparaît que dans la version boutique — le fichier
général ne le porte pas, il n'a personne à qui l'adresser.

Les `null` de cet exemple sont les manques réels décrits plus haut : photo
produit, adresse, téléphone, horaires.

---

## 10. Récapitulatif des manques

| Manque | Effort | Qui décide |
|---|---|---|
| Palette de campagne (4 couleurs) | court | vous, sur les valeurs par défaut |
| Photos produits — source ERP | court si la colonne existe | l'ERP |
| Photos produits — options par support | moyen | vous, sur la liste ci-dessus |
| Adresse, téléphone, horaires des boutiques | court | l'ERP, sur les noms de colonnes |
| Formats imprimés dans `mar_format` | une ligne par format | vous, sur les formats voulus |
| Route `/print` unique, générale et par boutique | moyen | — |

Rien de tout cela n'est bloquant pour dessiner le gabarit : les manques sont
identifiés, et un gabarit qui les prévoit n'aura pas à être redessiné quand ils
arriveront.
