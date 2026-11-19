# Audit design system — samsam2703MFC/signage

**RÈGLE retenue** — aucune couleur, police ni espacement en dur dans le front ; tout provient
d'une source unique partagée (`public/js/renderer.js`) réutilisée par la régie, le player, la
visionneuse et le rapport.

**PÉRIMÈTRE** — tout le repo. **Exclus explicitement** : `public/js/vendor/` (Preact/HTM
`preact-htm.js`, `qr.js`, `lottie.js` — code tiers non modifiable), `public/anim/`
(fichiers de contenu uploadés), `node_modules/`, `.git/`. Aucune migration ni fixture à exclure :
il n'y en a pas, les migrations vivent dans `server/db.js` sous forme d'`ALTER` gardés.

**Date** — audit au commit `11153da`. Lecture seule : aucun fichier existant n'a été modifié.

---

## 1. Synthèse

**Compteurs** — 3 conformes · 7 à adapter · 6 manquants · **1 419 littéraux hexadécimaux
dans `public/js/app.js` seul**, 1 656 sur l'ensemble du front hors vendor, dont **~180
occurrences de 22 teintes absentes de la palette**.

| # | Chantier prioritaire | Conséquence si on ne fait rien |
|---|---|---|
| 1 | `#F5EFE4`, le fond réel de **tous** les écrans (`public/js/renderer.js:283`), n'est pas dans `BRAND_COLORS` (`public/js/renderer.js:11`) | La palette « officielle » ne contient pas la couleur la plus visible du produit ; quiconque s'y fie peint un fond `#FBF8F2` et crée un écart visible en magasin |
| 2 | Les 6 sous-types de promotion sont semés avec une palette étrangère (`server/db.js:759-764` : `#8E44AD`, `#E67E22`, `#16A085`, `#2980B9`, `#D35400`) | Ces couleurs partent **en base** puis **à l'écran** en badge promo : du violet et du turquoise génériques sur une charte boulangerie |
| 3 | `BRAND_COLORS` n'est consommée qu'en 3 lignes (`public/js/app.js:3451-3453`), soit ~0,2 % des couleurs du front | La source unique existe mais ne gouverne rien : elle dérive silencieusement du code réel à chaque commit |
| 4 | Rampe de gris fantôme hors palette : `#B8B2A8`, `#C9C3B8`, `#4A4640`, `#5B564E`, `#6E675E` (49 occurrences, ex. `public/js/app.js:2256`) | Cinq gris pour trois besoins ; tout changement de charte oblige à un grep manuel avec risque d'oubli |
| 5 | Aucune variable CSS, aucun linter, aucun test de jeton (`public/css/base.css` sans `--*`, pas d'`eslint.config.*`) | Rien n'empêche mécaniquement la prochaine couleur en dur : la règle est déclarative, pas outillée |

---

## 2. Comment ce repo est organisé (avec chemins)

1. **Serveur zéro-dépendance** — `server/index.js:43` sert le statique de `public/` et route
   `/api/v1/*` vers `server/api.js` ; `package.json:14` exige Node ≥ 22.5, aucune dépendance npm.
2. **Données** — `server/db.js` (2 243 l.) : schéma SQLite `sig_*`, migrations par `ALTER`
   gardés (`server/db.js:332`), seeds, et le générateur de boucle `buildContinuous`.
3. **Auth** — `server/api.js:718` est la barrière unique : tout ce qui est écrit après exige une
   session back office ; `server/auth.js` gère le verrouillage.
4. **Périphérie serveur** — `server/pwadb.js` (import MySQL de l'ERP), `server/mirror.js`
   (réplication inverse), `server/livetest.js` (tests joués à chaque publication).
5. **Front, 5 pages** — `public/index.html` (régie), `player.html`, `film.html`, `agence.html`,
   `report.html` ; toutes chargent `public/css/base.css` et ont un `<style>` inline de 4 à 8 lignes.
6. **Régie** — `public/js/app.js` (6 397 l.), une seule classe `App`, styles écrits en attributs
   `style="…"` dans des littéraux `htm` ; aucun composant extrait.
7. **Modules partagés serveur ET navigateur** — `public/js/renderer.js` (moteur de rendu 6480×3840
   + constantes `RUBY`/`INK`/`FVANK`/`FUI` + `BRAND_COLORS`), `continuous.js`, `html-templates.js`,
   `i18n.js` ; `server/db.js` les importe.
8. **Consommateurs du rendu** — `public/js/film.js:9`, `player.js:6`, `report.js:6` importent
   `renderModule` et quelques constantes depuis `renderer.js`.
9. **Styles** — `public/css/base.css` (86 l.) : 5 `@font-face` (Gotham ×4, Vank), reset, styles des
   bulles d'aide `.sig-info` / `.sig-tip`. **Aucune variable CSS.**
10. **Outillage** — `test/live-test.js` (1 229 l., 65 tests HTTP réels) ; `.github/workflows/deploy.yml`
    déploie par rsync+SSH puis rejoue les tests. **Aucun linter, aucun formateur, aucun build.**

---

## 3. Signaux retenus pour cet audit

Ce qui, dans **ce** repo, constitue une violation de la RÈGLE :

| S | Signal | Comment il se cherche |
|---|---|---|
| S1 | Littéral hexadécimal dans un `.js`/`.html`/`.css` hors définition de palette | `grep -o "#[0-9A-Fa-f]\{3,8\}"` |
| S2 | Littéral `rgba()` / `rgb()` porteur d'une teinte de marque | `grep -o "rgba\?("` |
| S3 | Teinte absente de `BRAND_COLORS` (`public/js/renderer.js:11-24`) — **dérive** | diff des teintes distinctes contre la liste |
| S4 | Deux teintes différentes pour **le même sens** (succès, alerte, erreur) | regroupement sémantique manuel |
| S5 | Liste de couleurs définie **ailleurs** que dans `BRAND_COLORS` — palette concurrente | `grep "color: '#"` sur les `const … = [` |
| S6 | Couleur de marque en dur **côté serveur** (défaut de colonne, seed) | `grep "#" server/*.js` |
| S7 | Police en littéral au lieu des constantes `FVANK`/`FUI` (`public/js/renderer.js:5-6`) | `grep "font-family\|fontFamily"` |
| S8 | Valeur d'espacement/rayon répétée sans jeton (partie « espacement » de la règle) | `grep -o "border-radius:[0-9]*px"` |
| S9 | **Absence** : pas de variables CSS, pas de test de jeton, pas de règle documentée, pas de lint | inspection de `public/css/base.css`, `test/`, `README.md`, racine |

---

## 4. Tableau principal

| # | Module | Cas d'usage / besoin | Constat (fichier:ligne) | Verdict | Ce qu'il faut faire | Effort | Prio | Conséquence si on ne fait rien |
|---|---|---|---|---|---|---|---|---|
| 1 | Palette | Une source unique de couleurs | `public/js/renderer.js:11-24` — 12 teintes exportées | **À ADAPTER** | Incomplète : voir #2. Y ajouter les teintes réellement diffusées | S | P1 | Une palette fausse est pire qu'aucune : elle fait croire à une norme |
| 2 | Rendu écran | Fond de l'écran de diffusion | `#F5EFE4` à `renderer.js:283,377,383,398,415` et `app.js:2257` — **absent** de `BRAND_COLORS` | **MANQUANT** | Ajouter `{ id:'ecran', name:'Fond écran', hex:'#F5EFE4' }` et remplacer les 6 littéraux | S | **P1** | La couleur la plus vue du produit n'est pas gouvernée ; écart visible en magasin |
| 3 | Promotions | Couleur de badge par sous-type | `server/db.js:759-764` — `#8E44AD`, `#E67E22`, `#16A085`, `#2980B9`, `#D35400` | **À ADAPTER** | Reseeder sur la palette ; migration ponctuelle pour les bases existantes | M | **P1** | Violet/turquoise génériques diffusés en magasin sur une charte boulangerie |
| 4 | Régie | Styles de l'interface | 1 419 hex dans `public/js/app.js` (ex. `:2552`, `:47`) | **À ADAPTER** | Remplacer par des jetons ; commencer par les 8 teintes les plus fréquentes (1 077 occurrences) | L | P2 | Tout changement de charte est un grep de 1 400 lignes |
| 5 | Régie | Catégories de film colorées | `public/js/app.js:47-53` — palette concurrente `FILM_CATS` | **À ADAPTER** | Référencer `BRAND_COLORS` par id au lieu de recopier les hex | S | P2 | Deux listes à maintenir ; divergence garantie |
| 6 | Réseau | Couleur d'état d'un écran | `public/js/app.js:2552` `STCOL` — `#2E7D32` alors que la palette dit `#2E6E4E` | **À ADAPTER** | Un seul vert « succès » ; idem `:2564`, `:2613` | S | P2 | Deux verts côte à côte dans le même écran |
| 7 | Promotions | Couleur de repli d'une promo | `#C0392B` à `app.js:371,1058,3004` et `server/db.js:463,792` alors que le rubis est `#8D1D2C` | **À ADAPTER** | Un seul rouge de marque | S | P2 | Deux rouges pour le même sens |
| 8 | Régie | Gris de texte secondaire / bordures | `#B8B2A8`, `#C9C3B8`, `#4A4640`, `#5B564E`, `#6E675E` — 49 occ., ex. `app.js:2256,2476,2844,4116` | **MANQUANT** | Définir une rampe de gris nommée (3 niveaux) dans la palette | M | P2 | Cinq gris pour trois besoins |
| 9 | Rendu écran | Fonds « média absent » | `#141414` (`renderer.js:263`), `#1B1B1B` (`:288`), `#0A0A0A` | **MANQUANT** | Un jeton « fond sombre » unique | S | P3 | Trois noirs presque identiques |
| 10 | Base | Défauts de couleur en colonne | `server/db.js:449,514,535` (`#C97B4A`, `#8D1D2C`) | **À ADAPTER** | Importer les valeurs depuis la palette partagée, déjà importable côté serveur | S | P3 | Le schéma fige des hex que le front peut faire évoluer |
| 11 | Typographie | Familles de police | `FVANK`/`FUI` à `renderer.js:5-6`, mais `'Gotham'` en dur ×4 (`public/css/base.css:36,40`) et `ui-monospace` ×31 (`app.js`) | **À ADAPTER** | Jeton `FMONO` ; `base.css` reste la source des `@font-face` | S | P3 | La police mono n'a pas de source unique |
| 12 | Feuille de style | Jetons CSS | `public/css/base.css` — 0 `--*`, hex en dur `:33,38,39,42,43,51,54,58,66,75,82` | **MANQUANT** | Déclarer les jetons en `:root` et les consommer | M | P2 | Le CSS et le JS portent deux copies des mêmes teintes |
| 13 | Qualité | Empêcher la prochaine couleur en dur | Aucun `eslint.config.*` à la racine | **MANQUANT** | Règle de lint interdisant `#RRGGBB` hors `renderer.js`, branchée en CI | M | P2 | La règle reste déclarative ; la dette repart à chaque commit |
| 14 | Tests | Vérifier que la palette gouverne | `test/live-test.js` — aucune assertion de jeton (`:536` teste une valeur métier, pas la charte) | **MANQUANT** | Test : « aucun hex hors palette dans `public/js/` » | S | P2 | Rien ne détecte une régression de charte |
| 15 | Doc | Règle écrite | `README.md` — la palette est mentionnée `:269` mais aucune règle imposée | **MANQUANT** | Une section « design system : la règle » | S | P3 | Le prochain contributeur ne peut pas deviner la norme |
| 16 | Espacement | Rayons de bordure | `border-radius:999px` ×131, `8px` ×100, `7px` ×69, `10px` ×47, `9px` ×45, `16px` ×39 dans `app.js` | **À ADAPTER** | 3 jetons (pilule, contrôle, carte) au lieu de 6 valeurs voisines | M | P3 | `7px`/`8px`/`9px`/`10px` pour le même rôle : incohérence visible |
| 17 | Rendu partagé | Constantes de marque réutilisées | `renderer.js:4-5` `RUBY`/`INK` importés par `film.js:9`, `player.js:6`, `report.js:6` | **CONFORME** | — | — | — | — |
| 18 | Typographie | Chargement des polices | `public/css/base.css:4-29` — 5 `@font-face`, un seul endroit, toutes les pages le chargent | **CONFORME** | — | — | — | — |
| 19 | Rendu partagé | Moteur unique | `renderModule` (`renderer.js`) utilisé par la régie, le player, la visionneuse et le rapport | **CONFORME** | — | — | — | — |

---

## 5. Violations à supprimer — un bloc par occurrence

### V1 · Palette étrangère semée en base — `server/db.js:759-764`

```
['happy-hour', 'Happy hour', '🕒', '#8E44AD', …]
['flash',      'Vente flash','⚡', '#E67E22', …]
['bundle',     'Bundle',     '🎁', '#16A085', …]
['bxgy',       'Achetez X',  '➕', '#2980B9', …]
['scheduled',  'Remise',     '📅', '#C0392B', …]
['voucher',    "Bon d'achat",'🎟️', '#D35400', …]
```

Cinq de ces six teintes n'existent nulle part ailleurs dans le produit. Elles sont écrites en base
au premier démarrage (`ensurePromoTypes`), relues par `loadPromoTypes` (`server/db.js:792`),
servies à la régie, puis **rendues en badge à l'écran** (`renderer.js:344-345`). Appelants :
`server/db.js:32`. Particularité : une base déjà en production les contient ; les corriger
demande une migration, pas seulement un changement de seed.

### V2 · Second vert de succès — `public/js/app.js:2552`, `:2564`, `:2613`

`#2E7D32` sert d'état « en lecture » / « en ligne » / « fibre », alors que `BRAND_COLORS` déclare
`vert #2E6E4E` (`renderer.js:17`). Les deux apparaissent dans le même écran Réseau.

### V3 · Second rouge — `public/js/app.js:371`, `:1058`, `:3004` et `server/db.js:463`, `:792`

`#C0392B` est le repli d'une promotion sans sous-type ; le rubis de marque est `#8D1D2C`
(`renderer.js:4`). Le repli est donc d'une autre teinte que la marque, à l'écran comme en régie.

### V4 · Rampe de gris non déclarée — 49 occurrences

`#B8B2A8` (`app.js:2256`…), `#C9C3B8` (`app.js:2844`…, `renderer.js:269`), `#4A4640`
(`app.js:4116`…), `#5B564E` (`app.js:2476`…), `#6E675E` (`renderer.js:366`). Aucune n'est dans la
palette, qui ne connaît qu'un gris (`#8A847C`).

### V5 · Trois noirs de fond — `renderer.js:263` (`#141414`), `:288` (`#1B1B1B`), `#0A0A0A`

Trois valeurs pour un seul besoin : le fond d'un écran de média manquant.

### V6 · Rose de survol hors palette — `public/css/base.css:39`

`a:hover { color: #6E1522; }` — variante sombre du rubis, définie nulle part ailleurs.

---

## 6. Existant à adapter — un bloc par élément

### A1 · `BRAND_COLORS` — `public/js/renderer.js:11-24`

**Ce qui cloche** : la liste a été créée pour alimenter **une seule** liste déroulante (fond de
vidéo, `app.js:3452`) et non pour gouverner la charte. Elle omet `#F5EFE4`, le fond réel de tous
les écrans, et toute la rampe de gris ; elle inclut en revanche `crème #FBF8F2`, qui est une
couleur d'**interface** de la régie, pas de diffusion.
**Ce qui change** : la liste devient la référence — teintes de diffusion **et** teintes
d'interface, nommées par rôle et non par nuance.
**Qui est impacté** : `app.js:3451-3453` (seul consommateur actuel), plus tout futur sélecteur de
couleur. Aucun changement de rendu tant que les littéraux ne sont pas remplacés — l'adaptation est
donc sans risque immédiat.

### A2 · `FILM_CATS` — `public/js/app.js:47-53`

**Ce qui cloche** : cinq couples id/couleur recopiés en dur, qui doublonnent la palette.
**Ce qui change** : référencer un id de palette (`{ id:'saison', colorId:'caramel' }`).
**Qui est impacté** : `filmCatOf` (`app.js:54`) et ses appelants d'affichage.

### A3 · `STCOL` — `public/js/app.js:2552`

**Ce qui cloche** : cinq couleurs d'état écrites en dur, dont un vert qui n'est pas celui de la
palette.
**Ce qui change** : jetons sémantiques (`ok`, `warn`, `error`, `idle`) tirés de la palette.
**Qui est impacté** : le tableau de bord Réseau (`app.js:2564`, `:2613`, `:2634`).

### A4 · Défauts de colonne — `server/db.js:449`, `:514`, `:535`, `:463`

**Ce qui cloche** : la charte est figée dans le DDL SQLite ; changer la marque demanderait une
migration.
**Ce qui change** : garder un défaut neutre en base et résoudre la couleur à l'affichage depuis la
palette. `server/db.js` importe déjà `public/js/renderer.js` — le chemin existe.
**Qui est impacté** : `loadPromoTypes`, `loadCampaigns`, `loadSeasons`, `loadLibCategories`.

### A5 · `public/css/base.css`

**Ce qui cloche** : 11 littéraux hexadécimaux et aucune variable, donc une deuxième copie de la
charte à côté de celle du JS.
**Ce qui change** : `:root { --sig-rubis: … }` alimentées par la même liste, et un commentaire
renvoyant à `renderer.js` comme source.
**Qui est impacté** : les 5 pages, qui chargent toutes ce fichier.

### A6 · Rayons de bordure — `public/js/app.js`

**Ce qui cloche** : `7px`, `8px`, `9px`, `10px` cohabitent pour des contrôles de même nature
(261 occurrences cumulées).
**Ce qui change** : trois jetons — pilule (`999px`), contrôle (`8px`), carte (`16px`).
**Qui est impacté** : purement visuel, aucun contrat de données.

---

## 7. Manques transverses (contrat, convention, doc, tests)

1. **Aucune règle outillée** — pas d'`eslint.config.*` à la racine, `package.json:7` n'a pas de
   script `lint`. Rien n'empêche mécaniquement la 1 420ᵉ couleur en dur.
2. **Aucun test de charte** — `test/live-test.js` compte 65 tests, tous fonctionnels ; les seules
   couleurs citées (`:536`, `:763`, `:841`) vérifient un aller-retour de données, pas la charte.
   Un test statique « aucun hex hors palette dans `public/js/` » manque.
3. **CI muette sur le front** — `.github/workflows/deploy.yml` déploie puis rejoue les tests HTTP ;
   aucune étape ne lit le front. Une régression de charte passe le déploiement.
4. **Règle non documentée** — `README.md:269` mentionne `BRAND_COLORS` comme une fonctionnalité du
   volet vidéo, pas comme une norme. Rien ne dit à un contributeur où mettre une couleur.
5. **Nommage par nuance, pas par rôle** — `BRAND_COLORS` nomme `crème`, `lin`, `sable`
   (`renderer.js:19-22`) : trois beiges dont l'usage n'est pas déductible du nom. Un nommage par
   rôle (`fond-page`, `fond-carte`, `bordure`) rendrait les substitutions décidables.
6. **Pas de séparation diffusion / interface** — la palette mélange les couleurs vues par le client
   en magasin et celles de l'outil interne. Ce sont deux chartes avec deux cycles de vie.

---

## 8. Zones non couvertes par l'audit

- **`public/js/vendor/`** — exclu : code tiers (`preact-htm.js`, `qr.js`, `lottie.js`). Le lecteur
  Lottie génère du SVG dont les couleurs viennent du fichier d'animation, pas du repo ; les
  animations `.json` importées échappent donc structurellement à toute règle de charte.
- **Les gabarits HTML collés par l'utilisateur** — `html-templates.js:9` contient des hex
  (`#F5EFE4`…) dans des préréglages, mais le HTML réellement diffusé est saisi en régie et stocké
  en base (`mar_sig_modules.html`). **Je n'ai pas audité le contenu en base** : il n'est pas dans le repo.
- **Contraste et accessibilité** — aucun ratio WCAG n'a été calculé. Hors sujet de la RÈGLE posée.
- **Rendu réel** — audit statique uniquement. Je n'ai pas comparé le rendu à l'écran à une charte de
  référence : aucun document de charte n'existe dans le repo.
- **Cohérence des icônes et emojis** — utilisés massivement comme éléments visuels
  (`server/db.js:759-764`, boutons de `app.js`) ; ils relèvent d'un design system mais pas de la
  RÈGLE « couleur, police, espacement ».
- **`.tfb/module.json`** — inspecté, aucune couleur.
