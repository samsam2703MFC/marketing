# Prompt agent de code — Design system « L'Atelier By » : adapter les pages incorporées au module Marketing

> **À donner tel quel à un agent de code**, ouvert dans le dépôt du module dont les pages sont incorporées
> (Social, régie des écrans, cockpit, espace franchisé…). Joindre les deux captures, rangées à côté de ce
> document : `docs/design-system/rail-reference.png` (le rail) et `docs/design-system/page-reference.png`
> (une page complète du Marketing, à 1440 × 1000).
>
> Ce fichier est la **référence commune** du design de tous les modules. Quand le Marketing change une valeur
> (couleur, taille, composant), on la change ici dans le même commit.
>
> Source de vérité : le module **Marketing** (`samsam2703MFC/marketing`, `src/styles/global.css`,
> `src/components/Sidebar.tsx`, `src/lib/navigation.ts`, `src/views/media/media.css`), état du 06/11/2026.
> Toutes les valeurs ci-dessous en sont relevées. Les rares ajouts sont signalés comme tels : le focus clavier
> du rail, la forme d'un compteur dans le rail, le script du mode incorporé et les noms génériques donnés à
> quelques classes (`.toolbar`, `.chip--neutral`, `.badge--ok`).

---

## 0. Ta mission

Ce module a des pages que le module Marketing **incorpore** : il les affiche dans un cadre (`iframe`) à droite
de son propre rail, avec le paramètre `?embed=1`. Aujourd'hui elles n'ont pas le même aspect que le Marketing.

Tu dois **mettre toutes les pages de ce module au design system du Marketing** : même police, mêmes graisses,
mêmes tailles, mêmes couleurs, mêmes composants (boutons, champs, tableaux, cartes, pastilles, onglets…), et le
même rail quand la page est ouverte seule.

Le résultat : en passant d'un écran du Marketing à un écran incorporé, l'utilisateur ne doit **pas voir de
couture** — ni changement de police, ni de gris, ni de bouton, ni de marge.

**Tu changes l'apparence, pas le fonctionnement** : mêmes données, mêmes appels, mêmes routes, mêmes
libellés (sauf faute ou anglais), mêmes comportements.

---

## 1. Règles de travail

1. **Commence par l'inventaire** : liste les feuilles de style et les styles en ligne du module, les couleurs,
   tailles et polices utilisées, les composants récurrents (boutons, champs, tableaux…). Montre la table de
   correspondance « ancien → jeton du système » avant de modifier massivement.
2. **Reproduis les valeurs de ce document, pas ton interprétation.** Aucune couleur, taille, ombre ou graisse
   « améliorée ». Une valeur te semble fausse : signale-la, ne la corrige pas.
3. **Un seul endroit pour le système** : pose les jetons (§3) et les composants (§7) dans une feuille commune du
   module (ou un bloc `<style>` partagé si le module n'a que des pages HTML), et fais pointer les pages dessus.
   Supprime les anciennes règles qu'ils remplacent : pas de doublon qui se surcharge.
4. **Remplace les valeurs en dur par les jetons** (`#8D1D2C` → `var(--accent)`…), y compris dans les styles
   en ligne et ceux calculés en JavaScript.
5. **Aucune donnée inventée** : pas de faux utilisateur, compteur ou lien. Ne touche pas aux textes métier.
6. Interface **en français**, apostrophes typographiques (`’`), pas d'emoji dans l'interface.
7. Adresses (retour à l'ERP, autres modules) lues dans la **configuration**, jamais écrites en dur.
8. Avance **page par page**, capture avant / après à 1440 × 1000 pour chacune, en mode seul **et** en mode
   incorporé (§9). Termine par la checklist du §12.

---

## 2. Principes

- **Pas d'ombre.** La hiérarchie repose sur les **bordures** (1 px `--line`) et les **fonds** (blanc sur
  papier). Seules exceptions, minuscules : le curseur de l'interrupteur et l'onglet actif d'un sélecteur
  segmenté (`0 1px 2px`).
- **Fond de l'application papier** `#faf7f2` ; **blocs blancs** (cartes, tableaux, barre supérieure, rail)
  bordés de `#e6e0d8`.
- **Une couleur de marque**, le bordeaux `#8D1D2C`, réservée à : l'action principale de l'écran (une seule), la
  sélection (onglet, pastille, entrée du rail), le focus, les liens d'action. **Jamais** pour une erreur ni pour
  décorer un titre.
- **Gris chauds** (brunâtres), jamais de gris bleuté ni de noir pur.
- **Un bouton FAIT, une pastille CHOISIT** : les deux ne se ressemblent jamais. Le bordeaux plein = l'action
  principale ; une sélection = liseré bordeaux sur fond teinté.
- **Petites tailles, beaucoup d'air** : l'essentiel du texte est entre 11 et 13 px ; les titres sont rares.
- **Chaque donnée à une seule place** : un écran à plusieurs vues = des onglets, pas plusieurs entrées de menu.

---

## 3. Couleurs (jetons à copier tels quels)

```css
:root {
  /* Texte */
  --ink: #1c1a17;        /* texte principal, titres, valeurs */
  --muted-2: #5c5852;    /* texte secondaire « actif » : libellés de boutons, entrées du rail, onglets au repos */
  --muted: #7a736a;      /* texte secondaire : aides, légendes, en-têtes de tableau, kicker */
  --faint: #B8B2A8;      /* libellés en capitales de groupe, champ désactivé */

  /* Surfaces et filets */
  --paper: #faf7f2;      /* fond de l'application ; survol discret */
  --table-head: #FBF9F5; /* en-tête de tableau, survol de ligne, bandeau de KPI */
  --total-line: #F8F4EE; /* ligne de total */
  --chip: #EDE7DE;       /* pastille neutre, piste d'interrupteur, fond de sélecteur segmenté */
  --line: #e6e0d8;       /* TOUTES les bordures */
  --row-line: rgba(34, 34, 34, 0.06); /* séparation entre lignes de tableau */

  /* Marque */
  --accent: #8D1D2C;     /* bordeaux : action principale, sélection, focus ; survol : #6f1622 */

  /* États */
  --danger: #b3261e;     /* erreur, action destructrice */
  --green: #3f7a52;      /* réussite, « mesuré », valide */
  --prize: #B0792A;      /* or : attention, interrupteur allumé, prime */
  --prize-soft: #F6E7CE; /* fond d'avertissement */
  --prize-ink: #7A5207;  /* texte d'avertissement */
  --stop: #A32014;       /* arrêt : uniquement une valeur devenue négative (marge…) */
  --stop-soft: #F7E0DC;  /* fond de l'arrêt */

  color-scheme: light;
  font-family: 'Gotham', system-ui, sans-serif;
  color: var(--ink);
  background: var(--paper);
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; }
```

Couleurs dérivées (garde-les sous cette forme) :

| Usage | Valeur |
|---|---|
| Survol de l'action principale | `#6f1622` |
| Fond d'une sélection (pastille, carte de choix) | `rgba(141, 29, 44, 0.05)` |
| Fond de l'entrée active du rail | `rgba(141, 29, 44, 0.08)` (≈ `#F6EDEE` sur blanc) |
| Fond « réussite / mesuré » | `rgba(63, 122, 82, 0.12)` avec texte `--green` |
| Survol d'un bouton destructeur | fond `rgba(179, 38, 30, 0.07)`, texte `--danger` |
| Bordure de pastille au repos | `rgba(34, 34, 34, 0.14)` |
| Voile d'une fenêtre modale | `rgba(24, 18, 20, 0.42)` |

Couleurs **réservées à l'identification**, jamais pour un texte courant ni un fond de bloc :

| Rôle | Jeton | Valeur |
|---|---|---|
| Canal Facebook | `--mc-fb` | `#1877F2` |
| Canal Instagram | `--mc-ig` | `#D6286F` |
| Meta (publicité) | `--mc-meta` | `#0866FF` |
| Google | `--mc-gg` | `#1E8E3E` |
| Newsletter | `--mc-nl` | `#6B4FBB` |
| Graphique : réalisé | `--chart-real` | `#B03048` |
| Graphique : période précédente | `--chart-prev` | `#EBD3D8` |
| Graphique : objectif | `--chart-goal` | `#1B6FA8` |
| Graphique : zone d'objectif | `--chart-goal-soft` | `#DEEAF3` |

Règles de couleur :
- Bordeaux ≠ rouge d'erreur ≠ rouge d'arrêt : trois rôles, trois couleurs, jamais échangées.
- Un état ne se dit jamais **par la couleur seule** : toujours un mot (« Actif », « Suspendu », « À vérifier »).
- Hiérarchie du texte : `--ink` (ce qu'on lit) > `--muted-2` (ce sur quoi on clique) > `--muted` (ce qui
  explique) > `--faint` (ce qui range).

---

## 4. Typographie

### 4.1 La police — et le piège des graisses

Police unique : **Gotham**, deux fichiers (copier depuis `marketing/public/fonts/`), déclarés **exactement** :

```css
@font-face { font-family: 'Gotham'; src: url('/fonts/Gotham_Regular.otf') format('opentype'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'Gotham'; src: url('/fonts/Gotham_Medium.otf')  format('opentype'); font-weight: 500; font-display: swap; }
```

| `font-weight` CSS | Fichier | Rendu à l'écran |
|---|---|---|
| `400` (défaut) | `Gotham_Regular.otf` | trait **appuyé, presque gras** — le plus fort du système |
| `500` | `Gotham_Medium.otf` | trait **moyen**, visiblement **plus léger** que le 400 malgré son nom |
| `600` / `700` | aucun fichier | le navigateur prend le 500 et l'épaissit (gras synthétique) |

**Dans ce système, 500 est plus léger que 400.** Ne « remets pas d'ordre » dans les chiffres : reprends les
graisses de chaque composant telles qu'écrites ici. N'ajoute pas d'autre fichier Gotham (Light, Book…).
Si le module est servi sous un sous-répertoire, adapte le **chemin** `/fonts/` à sa racine, pas les valeurs.

Supprime toute autre police d'interface du module (Inter, Roboto, Arial, polices système imposées…). Une
police **de contenu** propre à un visuel (affiche, post composé) peut rester dans ce visuel seulement.

### 4.2 Échelle des tailles (relevée dans le Marketing)

| Taille | Graisse | Usage |
|---|---|---|
| 26 px | 400, `letter-spacing: -0.01em` | **titre de page** (`h1` de la barre supérieure) |
| 24 px | 500, `-0.02em`, `line-height: 1.15` | grande valeur de KPI |
| 21 px | 400 | sous-titre d'écran (`.screen-subtitle`) |
| 22 px | 500 | valeur d'un bandeau de KPI |
| 18 px | 500 | titre d'un écran vide / d'attente |
| 16 px | 600 | titre de fenêtre modale |
| 15 px | 500 | titre de bloc, de fiche |
| 14 px | 500 | libellé d'interrupteur |
| 13 px | 400–500 | **texte courant** : tableaux, boutons, rail, champs de recherche |
| 12.5 px | 400–500 | texte secondaire : champs de formulaire, pastilles, filtres, aides |
| 12 px | 400 | petits boutons, notes, liens discrets |
| 11.5 px | 400 | pastilles de statut (`.chip`), légendes à droite d'un titre |
| 11 px | 600 | étiquettes d'avertissement (`.tag-warn`), kicker de la barre supérieure |
| 10.5 px | 400–600, capitales | en-têtes de tableau, libellés de KPI, sous-ligne de cellule, badges |
| 10 px | 500–600, capitales | libellés de groupe du rail, nom du module |

Capitales espacées (toujours `text-transform: uppercase`, jamais tapées en majuscules) :

| Élément | Taille | Espacement | Couleur |
|---|---|---|---|
| Kicker de page (« Vue Réseau ») | 11 px | `0.18em` | `--muted` |
| `h2` de bloc | 0.95rem (15,2 px), 500 | `0.06em` | `--muted` |
| Libellé de section (`.section-label`) | 0.72rem (11,5 px), 600 | `0.08em` | `--muted` |
| En-tête de tableau | 10.5 px, 400 | `0.06em` | `--muted` |
| Libellé de KPI | 10.5 px, 600 | `0.08em` | `--faint` |
| Libellé de groupe du rail | 10 px, 500 | `0.14em` | `--faint` |
| Nom du module dans le rail | 10 px, 600 | `0.2em` | `--accent` |

Interlignage : `normal` pour l'interface ; `1.45`–`1.6` pour un paragraphe d'aide de plusieurs lignes ;
`1.15` pour une grande valeur chiffrée. Les nombres alignés en colonne (tableaux) : `text-align: right`
(`.num`).

---

## 5. Espacements et rayons

| Rayon | Usage |
|---|---|
| 4 px | étiquette d'avertissement (`.tag-warn`, `.tag-stop`), `code` |
| 7 px | onglet actif d'un sélecteur segmenté |
| 8 px | **boutons, champs, filtres**, bouton d'action du rail |
| 9 px | entrées du rail, sélecteur segmenté, cartouche d'enseigne |
| 10 px | pastilles de choix, cartouches (retour à l'ERP, bloc compte) |
| 12 px | **cartes, blocs, tableaux encadrés, interrupteur** |
| 999 px | pastilles de statut, badges, piste d'interrupteur |

Rythme : marges et écarts en **4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 24 px**. Une carte : `padding: 1.25rem`
(20 px). Une page : `22px 24px 40px`. Écart entre blocs d'une page : 16 px ; entre éléments d'une barre
d'outils : 8 px. Jamais de marge négative pour rattraper un décalage.

---

## 6. Mise en page

### 6.1 Page ouverte seule (avec rail)

```
┌──────────────┬───────────────────────────────────────────────┐
│ RAIL 246 px  │ barre supérieure (blanche, filet bas)         │
│ blanc        ├───────────────────────────────────────────────┤
│ défile seul  │ contenu (papier) — défile seul                │
└──────────────┴───────────────────────────────────────────────┘
```

```css
.workspace { display: flex; height: 100vh; overflow: hidden; }
.workspace__main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.app__body { flex: 1; overflow-y: auto; padding: 22px 24px 40px; }
.app__body > * { max-width: 1180px; }          /* largeur de lecture */
.app__body--wide > * { max-width: none; }      /* surface de travail (éditeur, assistant, médiathèque) */
```
La barre de défilement du contenu reste au **bord droit de la fenêtre** (c'est `.app__body` qui défile, ses
enfants qui sont bornés).

### 6.2 Page incorporée dans le Marketing — voir §9.

---

## 7. Composants (CSS exact)

### 7.1 Barre supérieure et titre de page

```html
<header class="topbar">
  <div>
    <p class="topbar__kicker">Vue Réseau</p>        <!-- le périmètre : « Vue Réseau » / « Vue Franchisé » -->
    <h1>Calendrier éditorial</h1>                   <!-- = libellé de l'entrée du menu qui mène ici -->
  </div>
  <div class="topbar__actions">…</div>              <!-- au plus une action principale -->
</header>
```
```css
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 18px 24px; border-bottom: 1px solid var(--line); background: #fff; }
.topbar__kicker { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
.topbar h1 { font-size: 26px; font-weight: 400; letter-spacing: -0.01em; margin: 0; }
.topbar__actions { display: flex; align-items: center; gap: 10px; }
```

### 7.2 Titres dans la page

```css
h2 { font-size: 0.95rem; font-weight: 500; margin: 0 0 0.5rem; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted); }                /* titre de carte/bloc */
.screen-subtitle { font-size: 21px; font-weight: 400; color: var(--ink); margin: 4px 0 14px; }
.section-label { margin: 1.5rem 0 0; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--muted); }
.section-label__aside { float: right; font-size: 11.5px; font-weight: 400; text-transform: none;
  letter-spacing: normal; color: var(--muted); }                /* légende à droite d'un titre */
.muted { color: var(--muted); margin: 0; }
.error { color: var(--danger); margin: 0.5rem 0 0; }
```

### 7.3 Carte

```css
.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem; }
.card ul:not([class]) { margin: 0; padding-left: 1.1rem; font-size: 0.9rem; line-height: 1.7; }
```

### 7.4 Boutons — un seul système

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 36px; margin: 0; padding: 7px 16px;
  border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink);
  font: 500 13px/1.2 'Gotham', system-ui, sans-serif;
  text-decoration: none; white-space: nowrap; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.btn:hover:not(:disabled) { border-color: var(--muted-2); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.is-busy { opacity: 0.6; cursor: progress; }

.btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn--primary:hover:not(:disabled) { background: #6f1622; border-color: #6f1622; }

.btn--ghost { background: transparent; border-color: transparent; color: var(--muted-2); }
.btn--ghost:hover:not(:disabled) { border-color: transparent; color: var(--ink); text-decoration: underline; }

.btn--danger { background: transparent; border-color: transparent; color: var(--muted-2); }
.btn--danger:hover:not(:disabled) { border-color: transparent; background: rgba(179, 38, 30, 0.07); color: var(--danger); }

.btn--sm { min-height: 30px; padding: 5px 11px; font-size: 12px; }
.btn--icon { flex: none; width: 28px; min-height: 28px; height: 28px; padding: 0; font-size: 12px; }

.linklike { padding: 2px 4px; font-size: 12px; color: var(--muted-2); background: none; border: 0;
  border-radius: 6px; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linklike:hover { color: var(--accent); }
```

| Classe | Rôle | Combien par écran |
|---|---|---|
| `.btn--primary` | l'action qui fait avancer (Valider, Publier, Suivant) | **une seule** |
| `.btn` | la plupart des actions | libre |
| `.btn--ghost` | sortie discrète (Annuler, Quitter sans enregistrer) | — |
| `.btn--danger` | retirer, effacer : discret, rouge au survol seulement | — |
| `.btn--sm` | dans le contenu, à côté d'un champ, dans une ligne de tableau | — |
| `.linklike` | lien d'action dans un texte ou une cellule | — |

Les mêmes classes vont sur `<a>` et `<label>` : l'aspect suit le rôle, pas la balise. Une action
irréversible demande une confirmation (§7.11), dont le bouton porte `--danger`.

### 7.5 Champs

```css
input, select, textarea { font: inherit; padding: 0.6rem 0.7rem; border: 1px solid var(--line);
  border-radius: 8px; background: #fff; color: var(--ink); }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
input:disabled, select:disabled { background: transparent; color: var(--faint); border-color: var(--line); cursor: not-allowed; }

/* Champ compact avec son libellé à gauche, dans une barre ou un formulaire dense */
.field { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--muted); }
.field input, .field select { padding: 5px 9px; font-size: 12.5px; border-radius: 8px; }

/* Barre d'outils : recherche + filtres, hauteur commune 36 px */
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.toolbar input[type=search] { flex: 1 1 260px; min-width: 200px; height: 36px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: 8px; font: 13px 'Gotham', system-ui, sans-serif; }
.toolbar select { height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px;
  background: #fff; font: 13px 'Gotham', system-ui, sans-serif; }
```
Un libellé au-dessus d'un champ : 11.5 px, `--muted`, 4 px au-dessus du champ. Les cases à cocher gardent
l'aspect natif, alignées avec leur libellé (`gap: 7px`, 13 px, `--ink`).

### 7.6 Choisir : filtres, pastilles de choix, sélecteur segmenté

```css
/* Filtre (choix exclusif dans une barre) : rectangle, bordeaux plein quand actif */
.filter { margin: 0; padding: 6px 13px; font-size: 12.5px; border: 1px solid var(--line);
  border-radius: 8px; background: #fff; color: var(--muted-2); }
.filter.is-on { background: var(--accent); border-color: var(--accent); color: #fff; }

/* Pastille de choix (option d'un formulaire) : liseré bordeaux 2 px et fond teinté quand choisie */
.choice-pill { margin: 0; background: #fff; border: 1px solid rgba(34, 34, 34, 0.14); border-radius: 10px;
  padding: 9px 16px; font-size: 12.5px; font-weight: 500; color: var(--muted-2); cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s; }
.choice-pill.is-on { border: 2px solid var(--accent); background: rgba(141, 29, 44, 0.05);
  color: var(--accent); padding: 8px 15px; }                     /* 1 px de padding en moins : rien ne bouge */

/* Sélecteur segmenté (2 à 4 vues d'une même liste : Tout / Photos / Vidéos) */
.seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--chip); }
.seg button { margin: 0; padding: 6px 11px; border: 0; border-radius: 7px; background: transparent;
  color: var(--muted-2); font: 500 12.5px 'Gotham', system-ui, sans-serif; cursor: pointer; }
.seg button.is-on { background: #fff; color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
```

### 7.7 Onglets de page

```css
.page-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 16px; border-bottom: 1px solid var(--line); }
.page-tabs__tab { margin: 0 0 -1px; padding: 8px 12px; border: none; border-bottom: 2px solid transparent;
  border-radius: 0; background: none; color: var(--muted-2); font: inherit; font-size: 13px;
  font-weight: 500; cursor: pointer; }
.page-tabs__tab:hover { color: var(--ink); }
.page-tabs__tab.is-on { color: var(--accent); border-bottom-color: var(--accent); }
```

### 7.8 Tableaux

```css
.table-card { margin-top: 1rem; }               /* s'emploie avec .card : <section class="card table-card"> */
.table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 820px; border-collapse: collapse; font-size: 13px; }
thead th { text-align: left; font-weight: 400; font-size: 10.5px; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--muted); background: var(--table-head); padding: 10px 14px; }
tbody td { padding: 13px 14px; border-top: 1px solid var(--row-line); }
.num { text-align: right; }
.row-link { cursor: pointer; }
.row-link:hover td { background: var(--table-head); }
/* Deuxième ligne d'une cellule : la valeur au-dessus, sa précision dessous */
.sub { display: block; margin-top: 2px; font-size: 10.5px; font-weight: 400; color: var(--muted); }
```
Pas de bordure verticale entre colonnes, pas de rayure. Une ligne de total : fond `--total-line`.

### 7.9 Pastilles d'état, badges, étiquettes

```css
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  font-size: 11.5px; white-space: nowrap; }
.chip--neutral { background: var(--chip); color: var(--ink); }
.dot { width: 8px; height: 8px; border-radius: 999px; }      /* point de couleur d'un canal, d'un levier */

.badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px;
  font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; }
.badge--ok { background: rgba(63, 122, 82, 0.12); color: var(--green); }

.tag-warn, .tag-stop { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.tag-warn { background: var(--prize-soft); color: var(--prize-ink); }   /* à vérifier, incomplet */
.tag-stop { background: var(--stop-soft); color: var(--stop); }         /* arrêt : valeur négative */
```

| État à dire | Forme |
|---|---|
| Actif, valide, mesuré | pastille fond `rgba(63,122,82,.12)`, texte `--green` |
| Brouillon, neutre, en attente | pastille fond `--chip`, texte `--muted-2` |
| À vérifier, incomplet, suspendu | `.tag-warn` (or) |
| Négatif, bloquant | `.tag-stop` |
| Erreur d'une action | texte `--danger` (`.error`) sous l'élément concerné |

### 7.10 Chiffres clés (KPI)

```css
.kpi-row { display: flex; flex-wrap: wrap; padding: 4px 0; }
.kpi { flex: 1; min-width: 176px; padding: 13px 18px; border-left: 3px solid var(--line); }
.kpi__value { font-size: 24px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.15; }
.kpi__label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--faint); margin-top: 5px; }
.kpi__note { font-size: 12px; color: var(--muted); margin-top: 3px; }
```
Montants en euros avec espace fine des milliers et virgule décimale (« 4 983,20 € ») ; dates en
français (« 06/11/2026 » ou « 6 nov. 2026 »).

### 7.11 Interrupteur, fenêtre de confirmation

```css
.switch { display: flex; align-items: center; gap: 12px; width: 100%; margin: 0; padding: 13px 16px;
  text-align: left; background: #fff; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); cursor: pointer; }
.switch__track { flex: 0 0 auto; position: relative; width: 38px; height: 22px; border-radius: 999px;
  background: var(--chip); transition: background 0.15s ease; }
.switch__track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(28, 26, 23, 0.25); transition: transform 0.15s ease; }
.switch.is-on .switch__track { background: var(--prize); }
.switch.is-on .switch__track::after { transform: translateX(16px); }
.switch__label { font-size: 14px; font-weight: 500; }
.switch__hint { font-size: 12.5px; color: var(--muted); }
/* <button class="switch" aria-pressed="true|false"> : un bouton qui porte son libellé et son explication */

.confirm { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(24, 18, 20, 0.42); }
.confirm__box { width: min(460px, 100%); padding: 22px 24px; }          /* + .card */
.confirm__box h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.confirm__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.confirm__danger { color: #fff; background: var(--danger); border-color: var(--danger); }
```

### 7.12 Icônes

SVG **linéaires** 16 × 16, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`stroke-width="1.7"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `aria-hidden="true"` ; la couleur
suit le texte. Pas d'icône pleine, pas d'icône de couleur, pas d'emoji. Catalogue des tracés : §8.4.

---

## 8. Le rail (page ouverte seule)

### 8.1 Structure et mesures

```css
.sidebar { flex: 0 0 246px; background: #fff; border-right: 1px solid var(--line); overflow-y: auto; padding-bottom: 24px; }

.sidebar__head { padding: 20px 16px 8px; }
.sidebar__logo { height: 26px; display: block; }   /* img/logo.png (708 × 121), copié depuis marketing/public/img/ */
.sidebar__kicker { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent);
  font-weight: 600; margin-top: 9px; }              /* « Module Social », « Cockpit »… */

.sidebar__back { padding: 6px 12px 4px; }
.sidebar__back a { display: flex; align-items: center; gap: 9px; background: var(--paper); border-radius: 10px;
  padding: 11px 13px; font-size: 13px; color: var(--muted-2); text-decoration: none; }   /* « Retour à l’ERP » */

.sidebar__brand { margin: 10px 12px 0; padding: 8px 10px; font-size: 13px; font-weight: 600; color: var(--ink);
  background: var(--table-head); border-radius: 9px; }   /* enseigne du périmètre : se lit, ne se choisit pas */

.sidebar__groups { padding: 2px 12px 0; }
.sidebar__group { margin-top: 18px; }
.sidebar__group-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint);
  font-weight: 500; padding: 0 10px 8px; }

.sidebar__action { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 2px 12px 8px;
  padding: 9px 12px; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 500;
  font-size: 13px; text-decoration: none; }        /* au plus un par rail : la création principale du module */
.sidebar__action:hover, .sidebar__action.is-active { background: #6f1622; color: #fff; }

.sidebar__item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 9px;
  font-size: 13px; font-weight: 500; color: var(--muted-2); text-decoration: none; transition: all 0.15s; }
.sidebar__item:hover { background: var(--paper); }
.sidebar__item.is-active { background: rgba(141, 29, 44, 0.08); color: var(--accent); font-weight: 400; }

.sidebar__item:focus-visible, .sidebar__back a:focus-visible, .sidebar__action:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; }

.sidebar__account { display: grid; gap: 4px; margin: 18px 16px 0; padding: 10px 12px; border: 1px solid var(--line);
  border-radius: 10px; font-size: 12px; }
.sidebar__account.is-dev { border-color: rgba(141, 29, 44, 0.45); background: rgba(141, 29, 44, 0.04); }
.sidebar__account-who { color: var(--ink); font-weight: 500; }
.sidebar__account.is-dev .sidebar__account-who { color: var(--accent); }
```

| Entrée du rail | Fond | Texte + icône | Graisse |
|---|---|---|---|
| Au repos | transparent | `--muted-2` | **500** (plus léger) |
| Survol | `--paper` | `--muted-2` | 500 |
| Active | `rgba(141,29,44,.08)` | `--accent` | **400** (plus appuyé) |

Mesures : entrée ≈ 34 px de haut, **accolées** (aucun espace entre elles), icône à 10 px du bord, texte à
9 px de l'icône. Libellé sur une ligne (2 à 4 mots) : raccourcir plutôt qu'élargir le rail.

### 8.2 HTML

```html
<nav class="sidebar" aria-label="Navigation principale">
  <div class="sidebar__head">
    <img class="sidebar__logo" src="{racine du module}img/logo.png" alt="L'Atelier By">
    <div class="sidebar__kicker">Module Social</div>
  </div>
  <div class="sidebar__back"><a href="{adresse de l'ERP, configuration}"><svg …><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Retour à l’ERP</a></div>
  <div class="sidebar__groups">
    <div class="sidebar__group">
      <div class="sidebar__group-label">Pilotage</div>
      <a class="sidebar__item is-active" aria-current="page" href="…"><svg …><path d="…"/></svg>Tableau de bord</a>
      <a class="sidebar__item" href="…"><svg …><path d="…"/></svg>Calendrier</a>
    </div>
  </div>
</nav>
```

### 8.3 Comportement

- **Une seule entrée active** : celle de l'écran affiché ; un sous-écran, un onglet ou une fiche allume
  l'entrée qui y mène (table explicite « écran → entrée du menu »). `aria-current="page"` sur l'active.
- Groupes dans l'ordre de l'usage : piloter → le cœur du module → les canaux → le budget → les **paramètres en
  dernier** ; 2 à 6 entrées par groupe ; libellés au nom de la chose (« Médiathèque », « Avis & fiches Google »).
- Une entrée que le rôle ne peut pas ouvrir n'est **pas affichée** (pas grisée).
- Compteurs (ex. « 3 posts à valider ») : le Marketing n'en a pas. Si ce module en a d'utiles, garde
  l'information sous la forme d'un nombre en 11 px `--accent`, poussé à droite (`margin-left: auto`), sans
  pastille pleine — et **signale-le** comme écart à valider.
- Le rail est prévu pour un poste de travail (≥ 1024 px). N'invente pas de tiroir mobile : signale le besoin.
- Le lien « Retour à l’ERP » du Marketing n'a pas encore de destination : ne copie pas ce manque, prends
  l'adresse dans la configuration, ou signale qu'elle n'existe pas.

### 8.4 Catalogue d'icônes (tracés `d`, à réutiliser pour les mêmes notions)

| Notion | Tracé |
|---|---|
| Tableau de bord | `M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z` |
| Calendrier | `M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z` |
| Calendrier éditorial | `M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01` |
| Campagnes | `M3 11l14-7v16L3 13zM7 14v5` |
| Médiathèque | `M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M15.5 9a1.5 1.5 0 1 0 0-.01` |
| Offres (%) | `M19 5L5 19M7 7a1.5 1.5 0 1 0 .01 0M17 17a1.5 1.5 0 1 0 .01 0` |
| Brochures | `M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16` |
| Bundles | `M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8` |
| Bons | `M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 6v12` |
| Écran / magasin | `M3 4h18v12H3zM8 20h8M12 16v4` |
| Agences | `M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18` |
| Analyse | `M4 20V10M10 20V4M16 20v-7M22 20H2` |
| Personnes / CRM | `M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9` |
| Fonds / budget | `M3 7h18v12H3zM3 7l3-4h12l3 4M16 13h.5` |
| Grille Instagram | `M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18` |
| Créer / écrire | `M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z` |
| Repost | `M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3` |
| Contrôle | `M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11` |
| Publicités | `M4 4h16v12H4zM2 20h20M9 8l4 2-4 2z` |
| Connexions / liens | `M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7` |
| Performance | `M3 17l6-6 4 4 8-8M15 7h6v6` |
| Formulaires | `M4 4h16v16H4zM8 8h8M8 12h8M8 16h5` |
| Bilan | `M3 3v18h18M7 15l4-4 3 3 5-6` |
| Avis (étoile) | `M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z` |
| Commentaires | `M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5` |
| Messages privés | `M4 4h16v12H5.17L4 17.17V4zM22 2H2v22l4-4h16V2z` |
| Recherche / Google | `M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5.2-5.2` |
| Clés | `M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4` |
| Cadenas / variables | `M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5zM12 15v2` |
| Adresse | `M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z` |
| Droits | `M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 12 0v1M19 8v6M22 11h-6` |
| Journal | `M12 8v4l3 3M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9` |
| Modèles | `M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5` |
| Retour | `M19 12H5M12 19l-7-7 7-7` |
| Ajouter | `M12 5v14M5 12h14` |

---

## 9. Pages incorporées dans le Marketing (le cas principal)

Le Marketing ouvre la page dans un `iframe` qui occupe **toute la zone à droite de son rail** (largeur de la
fenêtre moins 246 px, toute la hauteur), avec `?embed=1` dans l'adresse. **Le Marketing n'affiche alors ni barre
supérieure ni titre au-dessus du cadre** : c'est la page incorporée qui les porte.

En mode incorporé (`embed=1` **et** `window.parent !== window`), la page doit :

1. **Masquer son propre rail** (et tout menu, en-tête ou pied de page d'application qu'elle aurait) : le rail
   du Marketing est déjà à gauche.
2. **Afficher sa barre supérieure** exactement comme §7.1, en haut, pleine largeur : kicker du périmètre
   (« Vue Réseau » / « Vue Franchisé ») et titre = libellé de l'entrée du rail du Marketing qui y mène.
3. Puis son contenu sur fond **papier**, `padding: 22px 24px 40px`, enfants bornés à 1180 px (sauf surface de
   travail), défilement vertical **dans le cadre**, jamais de défilement horizontal à 1440 − 246 = 1194 px de
   large.
4. Garder `embed=1` sur **tous ses liens internes** (sinon la page suivante réaffiche son rail dans le cadre).
5. Ne jamais ouvrir de fenêtre ou de navigation qui sortirait du cadre sans le dire (lien externe :
   `target="_blank"` et la flèche « ↗ » dans le libellé).
6. Avoir le **même fond, la même police et les mêmes gris** que le Marketing autour : aucune bordure, aucun
   cadre ni coin arrondi autour de la page entière.

```js
// Mode incorporé : pas de second rail ; les liens internes le gardent.
const embed = new URLSearchParams(location.search).get('embed') === '1' && window.parent !== window;
if (embed) {
  document.documentElement.classList.add('is-embedded');
  document.querySelectorAll('a[href]').forEach((a) => {
    const url = new URL(a.getAttribute('href'), location.href);
    if (url.origin === location.origin && !url.searchParams.has('embed')) {
      url.searchParams.set('embed', '1');
      a.setAttribute('href', url.pathname + url.search + url.hash);
    }
  });
}
```
```css
.is-embedded .sidebar { display: none; }
.is-embedded .workspace { height: 100vh; }   /* la colonne de contenu prend toute la largeur du cadre */
```
Si le module a déjà sa convention d'incorporation (Social : `SA.embed`, `SA.href()` qui ajoute `embed=1`,
`navDisplay: 'none'`), **garde-la** et branche-y ces règles plutôt que d'en créer une seconde.

Ouverte seule (sans `embed=1`), la même page affiche le rail du §8 à gauche et la barre supérieure en haut.

---

## 10. Méthode d'adaptation, page par page

1. **Inventaire** (§1.1) et table de correspondance : chaque couleur existante → un jeton du §3 ; chaque taille
   → la plus proche de l'échelle du §4.2 ; chaque bouton → une classe du §7.4 ; chaque tableau → §7.8.
   Une couleur sans équivalent : choisis le jeton du même **rôle** (texte secondaire → `--muted`), pas la
   teinte la plus proche.
2. **Fondations** : `@font-face`, `:root`, `body`, puis composants du §7 dans la feuille commune.
3. **Coquille** : rail + barre supérieure + contenu (§6, §8), mode incorporé (§9).
4. **Pages** : remplace les styles en ligne et les classes ad hoc par les composants. Un composant propre à ce
   module (calendrier, grille Instagram, aperçu de post) garde sa structure mais prend les jetons : filets
   `--line`, coins 8–12 px, textes aux tailles de l'échelle, sélection en bordeaux, pas d'ombre.
5. **Aperçus de contenu** (visuel de post, affiche, aperçu d'e-mail) : ce qui **représente le support publié**
   garde ses propres couleurs et polices ; seul le cadre autour suit le système.
6. **Vérification** à chaque page : capture seule + incorporée, comparée à `page-reference.png`.

---

## 11. Pièges déjà rencontrés (ne pas les refaire)

- **Graisses inversées** : 500 est plus léger que 400 (§4.1). « Corriger » vers 400/600 alourdit tout.
- **Second rail dans le cadre** : respecter `embed=1` et le propager aux liens (§9).
- **Logo ou polices cassés sous un sous-répertoire** : chemins relatifs à la racine d'installation du module.
- **Bordeaux partout** : réservé à l'action principale, la sélection et le focus. Deux boutons bordeaux pleins
  sur un même écran = un de trop.
- **Rouge d'erreur pris pour le bordeaux** (ou l'inverse) : trois rouges, trois rôles (§3).
- **Ombres, dégradés, coins de 16 px et plus, gris bleutés, noir pur** : hors système.
- **Capitales tapées au clavier** : écrire en casse normale, laisser `text-transform` faire.
- **Tailles hors échelle** (15,5 px, 17 px, 0.83rem…) : ramener à l'échelle du §4.2.
- **Pastille qui ressemble à un bouton** ou l'inverse (§2, §7.4, §7.6).
- **Libellé sur deux lignes dans le rail** : raccourcir, ne pas élargir.

---

## 12. Checklist d'acceptation (à cocher dans ton compte rendu)

- [ ] Gotham partout, deux `@font-face` identiques (400 = Regular, 500 = Medium), aucune autre police d'interface.
- [ ] Jetons du §3 posés ; plus aucune couleur d'interface en dur hors jetons (vérifié par recherche).
- [ ] Tailles de texte toutes dans l'échelle du §4.2 ; capitales par `text-transform` avec les espacements du tableau.
- [ ] Fond papier, blocs blancs bordés `#e6e0d8`, aucune ombre hors interrupteur et sélecteur segmenté.
- [ ] Boutons : une seule action principale bordeaux par écran ; autres actions en `.btn` / `--ghost` / `--danger`.
- [ ] Champs, filtres, pastilles, onglets, tableaux, cartes, badges conformes au §7.
- [ ] Focus clavier visible partout (contour bordeaux 2 px).
- [ ] Page seule : rail du §8 (246 px, entrées 500 / active 400, une seule active) + barre supérieure.
- [ ] Page incorporée (`?embed=1` dans un cadre) : pas de rail, barre supérieure propre à la page, liens qui gardent `embed=1`, aucun défilement horizontal à 1194 px.
- [ ] Aucune route cassée, aucun comportement changé, aucun texte en anglais, aucune donnée inventée.
- [ ] Captures avant / après de chaque page, seule et incorporée, à 1440 × 1000.
- [ ] Compte rendu : fichiers touchés, table de correspondance, écarts restants (compteurs, composants propres au module) et pourquoi.
