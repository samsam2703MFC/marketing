# Base de données — module marketing (`mar_`)

Schéma issu de `DATA_MODEL.md` du handoff de design. **Toutes les tables portent le préfixe `mar_`**, sans exception — tables de liaison, de référence et d'historique comprises.

## Exécution

```bash
php db/migrate.php              # applique ce qui manque
php db/migrate.php --dry-run    # liste sans rien écrire
php db/migrate.php --baseline   # enregistre sans exécuter (base préexistante)
```

La connexion vient du fichier `.env` à la racine du déploiement (voir `.env.example`), ou de l'environnement du processus s'il est déjà renseigné — ce dernier reste prioritaire. Le fichier est nécessaire parce qu'une session SSH non interactive ne charge pas les profils de shell, et que PHP-FPM tient son environnement de la configuration du pool.

`--baseline` sert au cas d'une base créée avant l'existence du registre : sans lui, le runner tenterait de recréer des tables déjà présentes. Il le détecte d'ailleurs et le dit, plutôt que de laisser remonter une trace PHP.

`db/migrate.php` tient un registre — `mar_schema_migration` — et n'applique que les fichiers absents. Rejouer les `.sql` à la main fonctionne au premier chargement mais échoue au second, les `CREATE TABLE` se heurtant aux tables existantes. Les fichiers de vues font exception : écrits en `CREATE OR REPLACE`, ils sont rejoués à chaque passage pour qu'une vue modifiée soit réellement mise à jour.

L'ordre des fichiers est contraint par les clés étrangères — 010 (les vues) en dernier.

Le script commence par afficher la version du serveur et refuse de démarrer en dessous de **MySQL 5.7** ou **MariaDB 10.2** : le schéma a besoin du type `JSON` (`mar_crm_segment.rule_json`). Sans ce contrôle, les migrations échoueraient à mi-parcours en laissant une base à moitié créée.

### Encodage

Chaque fichier commence par `SET NAMES utf8mb4;`, et ce n'est pas décoratif : **le client `mysql` en ligne de commande est souvent configuré avec `character_set_client = latin1`**. Sans cette ligne, les accents de ce module sont double-encodés au chargement — « Planifiée » se stocke en `Planifi\xC3\x83\xC2\xA9e` au lieu de `Planifi\xC3\xA9e`, et ressort en « PlanifiÃ©e » dans l'API. Le schéma paraît correct, seuls les libellés sont corrompus, ce qui rend le défaut facile à manquer.

Ne retirez pas cette ligne, et si vous chargez les fichiers autrement, vérifiez :

```sql
SELECT HEX(SUBSTRING(label, 7, 2)) FROM mar_campaign_status WHERE code = 'planned';
-- attendu C3A9 (le « é »), pas C383C2A9
```

## État de validation

Le schéma a été **exécuté et vérifié**, pas seulement écrit :

| Contrôle | Résultat |
|---|---|
| Rejeu complet migrations + seeds sur base vierge | OK |
| Tables | 54 |
| Vues | 6 |
| Objets hors préfixe `mar_` | 0 |
| Clés étrangères | 74 |
| `SELECT` sur chacune des 6 vues, avec données | OK, valeurs contrôlées |
| Accents identiques via client CLI et via `migrate.php` | OK (`C3A9`) |

⚠️ **La validation a tourné sur MariaDB 10.11**, pas sur MySQL 8 : c'est le moteur qui a pu être installé dans l'environnement de développement. Le DDL n'utilise rien qui diverge entre les deux (pas de fonction de fenêtrage, pas de CTE, `JSON` seulement en stockage), mais un rejeu sur le moteur de production reste à faire avant mise en service.

## Décisions prises

`DATA_MODEL.md` laisse trois points explicitement ouverts (« selon le standard du projet », « à trancher côté back »). Choix retenus, uniformément :

| Point | Choix | Motif |
|---|---|---|
| Clé primaire | `BIGINT UNSIGNED AUTO_INCREMENT` | Plus compact que l'uuid en index, et le module n'a pas d'insertion distribuée |
| Montants | `DECIMAL(12,2)` | Le grand livre additionne et soustrait des royalties ; les centimes en entier obligeraient à convertir à chaque affichage |
| Moteur | InnoDB, `utf8mb4_unicode_ci` | Clés étrangères et texte français accentué |

Autres conventions appliquées : FK nommées `<entité>_id` sans préfixe (`campaign_id`), et `created_at` / `updated_at` / `created_by` sur toutes les tables transactionnelles.

`created_by`, `user_id`, `assignee_user_id`, `owner_user_id` ne portent **pas** de clé étrangère : la table des utilisateurs vit hors du module, dans le SI hôte. Même principe pour `mar_shop.erp_shop_id` et `mar_offer_item.sku_ref`, qui référencent l'ERP sans dupliquer boutiques ni produits.

## Ajouts au modèle

Trois tables ne figurent pas telles quelles dans `DATA_MODEL.md` :

- **`mar_campaign_status`** — le document porte `status` en clair sur `mar_campaign`, mais pose aussi la règle « les libellés visibles vivent en table de référence, pas en enum SQL ». Sans cette table, les quatre couleurs de statut du README resteraient codées en dur dans le front, ce qui est exactement ce qu'on cherche à éliminer.
- **`mar_campaign_b2b_sector`** — le document dérive le volume de leads « de la somme des `estimated_leads_count` des secteurs cochés à l'étape ① » sans nommer la table qui porte ce choix. Sans elle, l'étape ① de l'assistant n'est pas persistable.
- **`mar_v_lead_funnel_by_shop`** — voir ci-dessous.

## Vues

Cinq vues sont demandées par `DATA_MODEL.md`. Il y en a six.

`mar_v_lead_funnel` devait compter les leads « par état, par campagne et par boutique ». Écrite ainsi, elle ne peut pas afficher les états à zéro : une ligne sans lead n'a ni campagne ni boutique, donc un filtre par campagne la fait disparaître. Or l'entonnoir doit montrer ses cinq états en permanence. La vue fait donc un produit cartésien campagnes × états et zéro-remplit ; la ventilation par boutique part dans `mar_v_lead_funnel_by_shop`, où le zéro-remplissage porte sur les boutiques rattachées à la campagne et non sur tout le réseau.

Ce sont des vues SQL simples, pas des vues matérialisées — MySQL n'en a pas nativement. Si les volumes l'imposent, les basculer en tables de cache rafraîchies par tâche planifiée ; l'interface de lecture ne bouge pas.

## Divergences repérées dans le handoff

Deux incohérences entre les sources, tranchées provisoirement — **à confirmer côté design** :

1. **Couleurs de leviers.** `LEVER_DEFS` (prototype, pilote le grand livre et l'analyse) et `OFFER_LEVERS` (sélecteur de l'assistant) ne s'accordent pas :

   | Levier | `LEVER_DEFS` | `OFFER_LEVERS` |
   |---|---|---|
   | RECUR | `#F2C9A0` | `#C8794A` |
   | XP | `#C8794A` | `#6B8E5A` |

   Le seed retient `LEVER_DEFS`, qui couvre les six leviers de `LEVER_ORDER` là où `OFFER_LEVERS` n'en porte que quatre.

2. **Nombre de formats.** Le README annonce « déclinaison automatique aux 6 formats » ; le prototype en définit 5 — il manque un format « story ». Le seed reprend les 5 réellement définis.

## Contenu des seeds

Référentiels uniquement : statuts de campagne, leviers, 9 types de campagne, états de lead, 6 secteurs B2B, formats, postes, templates d'offre, accessoires terrain, canaux de diffusion.

**Aucune donnée de démonstration.** Les campagnes, vouchers, leads, agences et mouvements de fonds de la maquette illustrent des volumes et des formats attendus — le handoff est explicite là-dessus, ils ne doivent pas être repris en dur.

La liste des canaux (`mar_channel`) est la seule dérivée : le prototype ne porte pas de liste structurée, elle vient des écrans « Pub physique & PLV » et « Pub digitale » du README. À valider avec le marketing.
