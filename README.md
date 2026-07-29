# Régie d'affichage — L'Atelier By (module signage)

Back office de pilotage du signage (implémentation de la maquette **Back Office.dc.html**),
avec CMS, base de données, player d'écran et **tests live exécutés à chaque déploiement**.

- **Zéro dépendance** : Node.js ≥ 22.5 uniquement (`node:http` + `node:sqlite`). Pas de `npm install`.
- **Base SQLite** : toutes les tables sont préfixées **`sig_`** (`sig_modules`, `sig_module_items`,
  `sig_playlist`, `sig_stores`, `sig_players`, `sig_snapshots`, `sig_publications`,
  `sig_heartbeats`, `sig_settings`, `sig_users`, `sig_sessions`).
- **Front** : Preact + HTM embarqués (`public/js/vendor/`), aucun build.
- **Accès protégé** : le back office demande une connexion (`admin` / mot de passe
  `SIG_ADMIN_PASSWORD`, défaut `signage`) ; les players s'authentifient par token.

## Démarrer

```bash
npm start            # ou : node server/index.js
```

| URL | Rôle |
|---|---|
| `http://localhost:8080/` | Back office (connexion → Compositeur · Réseau · Paramètres) |
| `http://localhost:8080/film` | **Visionneuse publique du film** — dernière playlist publiée, plein écran, sans connexion |
| `http://localhost:8080/player.html?id=p1&token=plyr_9F3A2C7E` | Player d'exemple (magasin Centre-Ville) |
| `http://localhost:8080/api/v1/health` | Sonde de santé (publique) |

Variables : `PORT` (défaut 8080), `HOST`, `SIG_DB` (chemin SQLite, défaut `data/signage.db`),
`SIG_ADMIN_PASSWORD` (mot de passe du compte `admin`, appliqué à chaque démarrage),
`BASE_PATH` (chemin public si l'app est montée sous un sous-chemin, ex. `/signage`).
Au premier démarrage la base est créée et **seedée** avec le contenu de la maquette
(catégorie *Tartes* 8 produits, liaison *Fait maison*, 3 magasins / 5 écrans de démo).

## Déploiement sur http://185.180.206.46/signage/

Prérequis serveur : Node.js ≥ 22.5 (`node --version`).

```bash
# 1) Copier le dépôt sur le serveur
sudo mkdir -p /var/www/signage && sudo chown www-data: /var/www/signage
git clone <repo> /var/www/signage          # ou rsync/scp du dossier

# 2) Service systemd (écoute en local sur 127.0.0.1:8080)
sudo cp /var/www/signage/deploy/signage.service /etc/systemd/system/signage.service
sudo nano /etc/systemd/system/signage.service   # → changer SIG_ADMIN_PASSWORD !
sudo systemctl daemon-reload && sudo systemctl enable --now signage
curl http://127.0.0.1:8080/api/v1/health        # → {"ok":true,...}

# 3) Reverse proxy sur le site existant (Apache OU Nginx)
#    → deploy/apache-signage.conf  ou  deploy/nginx-signage.conf
#    montent l'app sous /signage/

# 4) Tests live post-déploiement, depuis n'importe où :
node test/live-test.js http://185.180.206.46/signage --password=VOTREMDP
node test/live-test.js http://185.180.206.46/signage --password=VOTREMDP --mutate
```

L'application est conçue pour fonctionner sous ce sous-chemin : toutes les URLs du front
sont relatives, et le serveur accepte les requêtes avec ou sans le préfixe (proxy qui
réécrit ou non). `BASE_PATH` sert au cookie de session et à la redirection
`…/signage` → `…/signage/`. Ne pas ouvrir le port 8080 sur l'extérieur : seul le
reverse proxy expose l'application.

### Comptes & sécurité

- Back office : utilisateur **`admin`**, mot de passe **`SIG_ADMIN_PASSWORD`**
  (défaut `signage` — à changer avant l'exposition publique). Sessions de 30 jours,
  verrouillage 60 s après 8 échecs.
- Players : token `plyr_…` par écran (`sig_players.token`). Un player inconnu muni d'un
  token `plyr_…` s'auto-enregistre dans « Nouveaux écrans ».
- Endpoints publics : uniquement `GET /api/v1/health` et les fichiers statiques.

## Fonctionnement

### Langue de l'interface (FR / EN / IT)
Un **sélecteur de langue** en en-tête (et sur l'écran de connexion) bascule toute la régie
entre **français, anglais et italien**. Le choix est **mémorisé par navigateur**
(`localStorage: sig_ui_lang`) — c'est une préférence d'affichage de l'outil, indépendante des
données. Les libellés vivent dans `public/js/i18n.js` (dictionnaire `{ clé: { fr, en, it } }`,
repli sur le français) ; `App.t('clé')` les résout à la volée selon la langue courante.

> À ne pas confondre avec la **langue diffusée à l'écran** par magasin (`sig_stores.lang`, réglée
> dans Réseau), qui traduit le *contenu* (noms de produits…) affiché au client, pas l'interface.

### Compositeur — flow en 3 étapes
**1 · Bibliothèque (construire)** : création des éléments. **2 · Playlist (ligne du temps)** :
glisser-déposer les éléments de la bibliothèque sur la timeline du film (blocs proportionnels
à la durée, réordonnancement par drag, films multiples nommés). **3 · Enregistrer & déployer** :
publication avec jours + fenêtre horaire + magasins ciblés, puis le lien public de visionnage
s'affiche immédiatement. Détail des capacités :
playlist (drag & drop, retrait sans suppression), bibliothèque (copier / dupliquer / supprimer),
tag campagne, programmation (jours + fenêtre horaire), 7 mises en page, mouvement par élément,
positions fines (curseurs **et** glisser-déposer directement sur l'aperçu), produits & tarifs
(illustration ou photo importée), aperçu animé 6480 × 3840 avec transport (lecture, boucle,
durée par ligne, scope module / playlist). Annuler / rétablir (⌘Z / ⌘⇧Z), espace = lecture/pause.

**Enregistrer** pousse le brouillon dans la base (`PUT /api/v1/draft`).

### Publication (versionnée, atomique) + tests live
« Publier sur le réseau » crée un **snapshot** en base :

- **Playlist complète** → `sig_snapshots(kind='playlist', version=N)`, `assigned_ver = N`
  sur les players ciblés (activation immédiate ou `activate_at` planifié).
- **Données prix seules** (ou bouton « ⚡ Pousser les prix ») → `sig_snapshots(kind='data', version=D)` :
  sync incrémentale légère, aucun média re-téléchargé.

Juste après l'écriture, le CMS **exécute des tests live en HTTP réel contre lui-même** :
intégrité du snapshot (JSON + présence des médias), `GET /players/{id}/assignment` pour chaque
player ciblé (la bonne version doit être servie), `GET /datasets/latest`, heartbeat dry-run.
Le résultat s'affiche dans le toast (« tests live 7/7 OK ») et le détail dans
**Paramètres → Serveur & connexion** ; il est archivé dans `sig_publications.tests`.

### Player (`/player.html`)
S'authentifie par token (`sig_players.token`), envoie un **heartbeat toutes les 5 s**
(état, cache %, média en cours, version jouée, disque). Quand une nouvelle version lui est
assignée : téléchargement du snapshot, **préchargement de tous les médias** (progression = cache %),
puis **bascule atomique** — l'ancienne playlist tourne jusqu'à ce que la nouvelle soit prête.
Respecte la programmation des modules (jours / fenêtre horaire) et le mode « ⚡ Diffusion flash ».

Un player inconnu qui se présente avec un token `plyr_…` est **auto-enregistré** dans le magasin
« Nouveaux écrans » — ouvrir `player.html?id=monecran&token=plyr_TEST42&name=Vitrine` suffit pour
le voir apparaître dans le réseau. Dans la vue Réseau, cliquer le nom d'un écran (↗) ouvre son player.

### Réseau & supervision
KPIs, alertes, état par magasin / écran depuis les vrais heartbeats : en ligne (< 30 s),
hors ligne (lecture depuis le cache local), version jouée vs assignée (« en retard »),
fraîcheur des prix (périmé > 1 h), cache, disque, dernier contact.

### Contenu dynamique par magasin
Un seul gabarit s'adapte à chaque point de vente, **résolu par magasin à la diffusion**
(côté serveur, dans `finishSnapshot` — même passe que les prix et la langue) :

- **Jetons de texte** — dans le **titre** ou le **sous-titre** d'un élément, écrire un jeton
  entre doubles accolades ; il est remplacé selon le magasin et le contexte :
  `{{magasin}}` (nom), `{{adresse}}`, `{{horaires}}`, `{{tel}}` (coordonnées saisies dans
  **Réseau**), `{{date}}` (date du jour), `{{saison}}` (période active du jour), `{{moment}}`
  (matin / midi / après-midi). Ex. « Bienvenue à {{magasin}} ». Le lien `?store=<id>` — et chaque
  écran — affiche les valeurs **résolues** ; l'aperçu générique laisse le jeton visible ; un jeton
  inconnu reste littéral (pour repérer une faute de frappe).
- **Coordonnées du magasin** — `sig_stores.address / hours / phone`, éditées en régie dans
  **Réseau** (`POST /api/v1/stores/{id}`), alimentent les jetons ci-dessus.
- **Rupture / indisponibilité** — bouton **⦸** par produit (onglet **Produits**,
  `sig_products.unavailable`) : le produit est **retiré des boucles en mode Continu** (le reste
  du catalogue continue) et signalé en régie. Prévu pour brancher un futur signal de stock ERP.

### Groupes d'écrans (grands magasins)
Un magasin peut piloter plusieurs **zones d'affichage indépendantes**, gérées dans **Réseau** :

- Chaque **groupe** (`sig_screen_groups`) a son propre **combo d'écrans** (taille/orientation)
  et un **filtre de catégories**. Un groupe avec des catégories diffuse une **boucle continue de
  ces catégories TOUTE LA JOURNÉE** (sans moment ni saison) ; sans catégorie il suit le film du
  magasin.
- Un **écran** (`sig_players.group_id`) rattaché à un groupe prend **son contenu et son format**
  (menu par écran, dans la fiche magasin) ; un écran sans groupe suit le film du magasin (défaut,
  rétro-compatible).
- Contenu résolu à l'assignation du player, avec les prix, la langue et les jetons du magasin
  (comme la visionneuse). Aperçu d'une zone : `GET /api/v1/film?group=<id>`.
- Le rendu utilise le canevas 6480 × 3840 mis à l'échelle de l'écran (limite existante de l'app) :
  une zone dont le combo est proportionnel au mur (ex. 3 × portrait) remplit nativement ; un
  simple écran portrait est mis à l'échelle. API : `POST /stores/{id}/groups`, `POST /groups/{id}`,
  `DELETE /groups/{id}`, `POST /players/{id}/group`.

### Promotions (offres commerciales)
Une **promotion** est un **type d'élément** à part entière (`sig_element_types` → `promotion`),
au même niveau que produit, liaison, animation… Dans le Compositeur : **＋ Élément →
« Promotion — offre » 🏷️**. On y saisit l'accroche (titre), le détail (sous-titre) et on choisit
un **sous-type**.

- Les **sous-types** (`sig_promo_types`) sont **dynamiques, pilotés par la base** — rien en dur :
  amorcés avec *happy hour, vente flash, bundle de produits, achetez X obtenez Y, remise planifiée,
  bon d'achat*, puis **gérables en régie** dans l'onglet **Promotions** (icône, couleur, libellé,
  ordre, actif/inactif). Chaque sous-type compose le **badge** affiché à l'écran.
- À l'affichage, le module résout son badge (`m.promo = { name, icon, color }`) via
  `loadModules()` — côté serveur ET dans l'aperçu régie. Mises en page : **bandeau** (fond aux
  couleurs de l'offre), **centré**, ou **hero** (photo du produit lié + prix).
- Supprimer un sous-type ne casse pas les éléments qui l'utilisaient : ils retombent sur un badge
  neutre « Offre » jusqu'à réassignation. Ces sous-types pourront être **alimentés depuis l'ERP**
  (menu Promotions) dans un second temps. API : `GET /promo-types`, `PUT /promo-types`.

### Campagnes marketing
Une **campagne** est aussi un **type d'élément** (`sig_element_types` → `campagne`), mais son
contenu vient d'une **liste d'entités** — on n'a qu'à en **déposer une comme item**.

- Les campagnes (`sig_campaigns`) se gèrent dans l'onglet **Campagnes** : nom, **portée**
  (*produit* → photo + prix du produit lié du catalogue, ou *gamme thématique* → libellé de thème),
  **visuel** (URL, sinon la photo du produit), **accroche**, **période** (du → au), couleur,
  actif/inactif, ordre. Liste **importable depuis l'ERP** ensuite.
- Dans le Compositeur : **＋ Élément → « Campagne marketing » 📣**, puis on **choisit la campagne**
  dans un menu. `loadModules` résout `m.campaign` (nom, portée, visuel, thème, dates) et, pour une
  campagne *produit*, l'`items[0]` depuis le produit lié — côté serveur ET dans l'aperçu régie.
- Mises en page : **visuel plein écran + accroche**, **centré**, ou **hero** (visuel/produit à
  gauche/droite + texte). Supprimer une campagne ne casse pas les éléments qui la diffusaient.
  API : `GET /campaigns`, `PUT /campaigns`.

### Paramètres
URL du CMS, IP / hôte player, token — persistés en base. **« Tester la connexion (live) »**
exécute côté serveur : ping TCP de l'hôte, `GET assignment`, `GET dataset prix`,
`POST heartbeat` (dry-run), avec latences réelles.

## Tests

```bash
npm test              # serveur jetable (BDD temporaire) + cycle complet — 51 tests
npm run test:live     # lecture seule contre http://localhost:8080 (ou BASE_URL / 1er argument)
npm run test:live:full            # cycle complet contre l'instance courante (publie réellement)
node test/live-test.js http://185.180.206.46/signage --password=… --mutate
```

Options du runner : `--user=…` `--password=…` (défaut `admin` / `signage`, ou
`SIG_ADMIN_PASSWORD`). Sort avec un code ≠ 0 si un test échoue — à brancher en post-deploy.
Le cycle `--mutate` vérifie notamment : protection 401 du back office, login, aller-retour
du brouillon, publication complète + **tests auto-exécutés au déploiement**, snapshot prix,
livraison de l'assignation au player, remontée de version par heartbeat.

## API (extrait)

```
publics        : GET /api/v1/health · fichiers statiques
session admin  : POST /api/v1/login · /logout · GET /me
                 GET /state · PUT /draft · GET /fleet · POST /publish
                 POST /stores/{id} (combo écrans · langue · coordonnées)
                 POST /stores/{id}/groups · POST/DELETE /groups/{id}
                 POST /players/{id}/group (rattacher un écran à une zone)
                 GET /catalog · PUT /catalog (produits · prix · rupture)
                 GET /promo-types · PUT /promo-types (sous-types de promotion)
                 GET /campaigns · PUT /campaigns (campagnes marketing)
                 POST /push-prices · POST /override · POST /test
                 GET /publications · POST /settings · GET /ping-host
token player   : GET  /api/v1/players/{id}/assignment?token=…
                 POST /api/v1/players/{id}/heartbeat
                 GET  /api/v1/datasets/latest?token=…
                 GET  /api/v1/snapshots/{version}?token=…
```

## Notes

- Les photos importées sont stockées en dataURL dans `sig_module_items.img` (simple et
  autonome ; migrer vers un stockage fichier si les volumes grossissent).
- Polices : sous-ensemble Gotham (300/400/500·600/700+) + Vank, servies depuis `public/fonts/`.
- Base : SQLite embarquée (fichier `data/signage.db`, tables `sig_*`). Si les tables doivent
  vivre dans une base MySQL/MariaDB existante de l'ERP, ajouter un driver est prévu —
  la couche d'accès est isolée dans `server/db.js`.
