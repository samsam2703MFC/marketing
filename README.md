# Régie d'affichage — L'Atelier By (module signage)

Back office de pilotage du signage (implémentation de la maquette **Back Office.dc.html**),
avec CMS, base de données, player d'écran et **tests live exécutés à chaque déploiement**.

- **Zéro dépendance** : Node.js ≥ 22.5 uniquement (`node:http` + `node:sqlite`). Pas de `npm install`.
- **Base SQLite** : toutes les tables sont préfixées **`sig_`** (`sig_modules`, `sig_module_items`,
  `sig_playlist`, `sig_stores`, `sig_players`, `sig_snapshots`, `sig_publications`,
  `sig_heartbeats`, `sig_settings`, `sig_users`, `sig_sessions`).
- **Front** : Preact + HTM embarqués (`public/js/vendor/`), aucun build.
- **Accès protégé** : le back office demande une connexion (`admin` / mot de passe
  `SIG_ADMIN_PASSWORD`, défaut `signage`) ; l'espace agence a son propre compte (`agence`),
  fermé tant que `SIG_AGENCY_PASSWORD` n'est pas défini ; chaque magasin peut avoir **son**
  compte (espace `/magasin`, FR/NL) ; les players s'authentifient par token.

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
`SIG_AGENCY_PASSWORD` (mot de passe du compte `agence` ; absent = compte fermé),
`BASE_PATH` (chemin public si l'app est montée sous un sous-chemin, ex. `/signage`),
`SIG_DEMO=1` (démo / tests uniquement).
Au premier démarrage la base est créée vide et se remplit par l'import PWA. Avec
`SIG_DEMO=1`, elle est **seedée** avec le contenu de la maquette (catégorie *Tartes*
8 produits, liaison *Fait maison*, 3 magasins / 5 écrans de démo — dont le player
d'exemple ci-dessus) et le compte `agence` garde son mot de passe de démo `agence`.

## Déploiement sur http://185.180.206.46/signage/

**Automatique** : chaque push sur la branche lance `.github/workflows/deploy.yml` —
transfert du code, provisionnement (Node ≥ 22, mots de passe, compte système `signage` et
son accès MariaDB, service systemd, proxy Apache, **https**), puis tests live. Secrets GitHub (Settings → Secrets and variables → Actions) :
`SERVER_HOST`, `SERVER_USER` (root), `SERVER_SSH_KEY`, `SIG_ADMIN_PASSWORD`,
`SIG_AGENCY_PASSWORD` — détail en tête du workflow.

- **Les fichiers uploadés ne sont jamais effacés.** Le transfert se fait sans `--delete`
  et ne touche ni `data/` ni `public/media/`, `public/surprise/`, `public/anim/` (médiathèque
  agence, vidéos surprise, fichiers d'animation). La livraison compte ces fichiers avant
  et après le transfert, et échoue si le nombre baisse.
- **Mots de passe hors du dépôt.** La livraison écrit les deux secrets dans
  `/etc/signage/signage.env` (root, 0600), que systemd lit via `EnvironmentFile=` ; l'unité
  versionnée n'en contient aucun, et l'ancien drop-in `signage.service.d/override.conf`
  (mot de passe admin en clair, lisible par tous) est supprimé.
- **https sur l'adresse IP.** Le serveur n'a pas de nom de domaine : la livraison obtient un
  certificat **Let's Encrypt pour l'adresse IP** (profil « shortlived », 6 jours — disponible
  depuis 2026), avec Certbot ≥ 5.4 isolé dans `/opt/certbot` (défi webroot sur le port 80,
  `/var/www/letsencrypt`). Hôte Apache `000-signage-ssl.conf` : port 443, **`/signage/`
  seulement**. Renouvellement par la minuterie `signage-certbot.timer` (deux passages par jour ;
  Certbot renouvelle à mi-vie). Tout échec est un **avertissement** et laisse http intact : port
  443 déjà pris → rien n'est touché ; Apache qui refuserait le 443 → hôte https et module SSL
  retirés, Apache relancé tel qu'avant. La livraison vérifie https depuis Internet (un port 443
  fermé par l'hébergeur ne donne qu'un avertissement). La régie constate elle-même son https
  (adresse, fin du certificat) : **Paramètres → Connexion sécurisée**.
- **Jamais root.** Le service tourne sous le compte système `signage` (voir « Comptes &
  sécurité »). Si la bascule échoue (droits, compte MariaDB, démarrage), la livraison
  remet le service en root — la régie et l'import ERP restent en marche — et échoue,
  pour qu'on le voie dans Actions ; la livraison suivante retente.

Installation manuelle (sans GitHub Actions) — prérequis : Node.js ≥ 22.5 (`node --version`).

```bash
# 1) Copier le dépôt sur le serveur
sudo mkdir -p /var/www/signage
git clone <repo> /var/www/signage          # ou rsync/scp du dossier

# 2) Mots de passe : hors du dépôt, lisibles par root seul
sudo install -d -m 0700 /etc/signage
sudo install -m 0600 /dev/null /etc/signage/signage.env
sudo nano /etc/signage/signage.env
#   SIG_ADMIN_PASSWORD="…"
#   SIG_AGENCY_PASSWORD="…"    ← facultatif : sans lui, l'espace agence est fermé
#   (entre guillemets doubles ; écrire \" pour un « " » et \\ pour un « \ »)

# 3) Compte du service (jamais root) : le code reste à root, seuls data/ et les
#    dossiers d'upload sont au compte signage
sudo useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin signage
cd /var/www/signage && sudo mkdir -p data public/media public/surprise public/anim
sudo chown -R signage:signage data public/media public/surprise public/anim && sudo chmod 0750 data

# 4) Import ERP sans utilisateur MySQL réglé en régie : accès MariaDB par la socket,
#    en lecture seule (la livraison automatique ajoute les droits du miroir, table par table)
sudo mariadb -e "CREATE USER IF NOT EXISTS 'signage'@'localhost' IDENTIFIED VIA unix_socket;
                 GRANT SELECT ON atelierby_db.* TO 'signage'@'localhost';"

# 5) Service systemd (écoute en local sur 127.0.0.1:8080)
sudo cp /var/www/signage/deploy/signage.service /etc/systemd/system/signage.service
sudo systemctl daemon-reload && sudo systemctl enable --now signage
curl http://127.0.0.1:8080/api/v1/health        # → {"ok":true,...}

# 6) Reverse proxy sur le site existant (Apache OU Nginx)
#    → deploy/apache-signage.conf  ou  deploy/nginx-signage.conf
#    montent l'app sous /signage/

# 7) Tests live post-déploiement, depuis n'importe où :
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
  (défaut `signage` tant que la variable n'a jamais été posée — à définir avant
  l'exposition publique). Sessions de 30 jours, verrouillage 60 s après 8 échecs.
- Espace agence : utilisateur **`agence`**, mot de passe **`SIG_AGENCY_PASSWORD`**. En
  production, **pas de mot de passe, pas de compte** : le défaut `agence` est refusé, et
  retirer le secret supprime le compte et ses sessions au redémarrage suivant.
  ⚙ Paramètres → « Espace Vidéo — Agence » dit si l'accès est ouvert ou fermé.
- Changer un mot de passe = changer le secret GitHub puis relancer le déploiement : au
  démarrage, le compte est réaligné sur la variable et ses sessions ouvertes sont coupées.
- Le service tourne sous le compte système **`signage`** — ni root, ni `www-data`
  (partagé avec les applis PHP du serveur). Le code appartient à root, en lecture seule
  pour lui ; il n'écrit que dans `data/` et les trois dossiers d'upload, et `data/` (base,
  sessions, réglages d'import) n'est lisible que par lui.
- Import ERP et miroir MySQL : sans utilisateur MySQL réglé dans ⚙ Paramètres → Catalogue
  PWA → Réglages avancés, ils passent par la socket MariaDB locale. La livraison y déclare
  le compte **`signage`@`localhost`**, authentifié par la socket (aucun mot de passe), avec
  la seule **lecture** de la base PWA et, pour le miroir, l'écriture de **ses** tables
  `sig_*` recopiées (jamais `sig_users` ni `sig_sessions`). Il ne peut ni modifier ni
  effacer une table de l'ERP, ni créer de base, ni s'attribuer de droits. Un utilisateur
  MySQL réglé en régie reste prioritaire : la livraison n'ouvre alors rien.
- Players : token `plyr_…` par écran (`sig_players.token`). Un player inconnu muni d'un
  token `plyr_…` s'auto-enregistre dans « Nouveaux écrans ».
- **Comptes magasin** : un compte par magasin, créé dans **Réseau → magasin → Compte magasin**.
  Le mot de passe est généré par le serveur et montré **une seule fois** ; « Nouveau mot de
  passe » coupe les sessions ouvertes. Le magasin d'un compte est fixé en base : le serveur
  refuse tout le reste (régie, autres magasins, médiathèque) — 403.
- En https, le cookie de session est `Secure` (en-tête `X-Forwarded-Proto` posé par l'hôte https).
- Endpoints publics : uniquement `GET /api/v1/health` et les fichiers statiques.

## Fonctionnement

### Langue de l'interface (FR / NL / EN / IT)
Un **sélecteur de langue** en en-tête (et sur l'écran de connexion) bascule toute la régie
entre **français, néerlandais, anglais et italien**. Le choix est **mémorisé par navigateur**
(`localStorage: sig_ui_lang`) — c'est une préférence d'affichage de l'outil, indépendante des
données. Les libellés vivent dans `public/js/i18n.js` (dictionnaire `{ clé: { fr, nl, en, it } }`,
repli sur le français) ; `App.t('clé')` les résout à la volée selon la langue courante.
L'**espace magasin** est entièrement en français et en néerlandais (langue du magasin par
défaut). À l'écran, l'attente sans programme ne montre que le logo — aucun texte à traduire.

### Espace magasin (`/magasin`)
Un compte par magasin (voir « Comptes & sécurité »), utilisable sur tablette ou téléphone :

- **Ses écrans** : état réel (en ligne, version jouée, fichiers sur l'écran, absents du serveur,
  redémarrage hors ligne possible), lien d'installation de chaque écran.
- **Le lien d'écran du magasin** (`film?store=…`), en https dès que le serveur l'offre.
- **Ruptures du jour** : « Épuisé » retire le produit de **ses** écrans — listes, « produit
  seul », promotions et campagnes liées — en moins d'une minute, sans toucher aux autres
  magasins. La rupture s'efface **à minuit, heure de Bruxelles** (indépendant du fuseau du
  serveur), ou dure jusqu'à remise en vente si on le demande. Les écrans se resynchronisent
  d'eux-mêmes (empreinte des ruptures du magasin, `storeStamp`). La régie voit les ruptures
  déclarées dans **Réseau**.

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
(état, cache réel, média en cours, version jouée, disque). Quand une nouvelle version lui est
assignée : téléchargement du snapshot, **téléchargement réel de chacun de ses fichiers**
(progression = cache %), puis **bascule atomique** — l'ancienne playlist tourne jusqu'à ce que
la nouvelle soit prête. Respecte la programmation des modules (jours / fenêtre horaire) et le
mode « ⚡ Diffusion flash ».

### Écrans hors ligne (player et liens `film?store=…`)
Chaque écran garde sur son disque (IndexedDB) **le dernier film reçu et tous ses fichiers** —
photos, vidéos, animations — et le rejoue **au démarrage, avant tout contact réseau** :

- La liste des fichiers d'un film est **unique** (`public/js/assets.js`), partagée par le serveur
  (champ `media` des snapshots), le player et la visionneuse ; les fichiers passent par des URL
  locales (`blob:`). Ce qui n'est pas dans le film (logos, fonds de catégorie) est gardé par le
  service worker.
- Un fichier en **échec réseau** bloque la bascule : l'écran garde l'ancienne version et retente
  (délai croissant). Un fichier **absent du serveur** (404) ne la bloque pas, mais est **signalé**.
- **Réseau → Écrans** affiche ce que l'écran a vraiment : « 10/11 fichiers sur l'écran · 1 absent
  du serveur · stockage protégé · redémarre hors ligne ✓ ». Le « cache 100 % » ne ment plus :
  l'ancien préchargement par `new Image()` échouait sur les vidéos et les comptait quand même.
- **Coupure réseau, page ouverte** : l'écran continue, en http comme en https.
- **Redémarrage sans réseau** : il faut le **service worker** (`/sw.js`, généré par
  `server/sw.js`), qui garde la page, son code, la CSS, les polices et le décor. Le navigateur ne
  l'autorise qu'en **https** (ou sur `localhost`) ; il se met à jour seul après chaque livraison
  (version = empreinte des fichiers) et l'écran se recharge sur le nouveau code.
- Le serveur sert les fichiers avec leur vrai type (vidéos comprises), un **ETag** (revalidation →
  304, rien n'est retéléchargé) et la **lecture partielle** (`Range` → 206).

Un player inconnu qui se présente avec un token `plyr_…` est **auto-enregistré** dans le magasin
« Nouveaux écrans » — ouvrir `player.html?id=monecran&token=plyr_TEST42&name=Vitrine` suffit pour
le voir apparaître dans le réseau. Dans la vue Réseau, cliquer le nom d'un écran (↗) ouvre son player.

### Réseau & supervision
KPIs, alertes, état par magasin / écran depuis les vrais heartbeats : en ligne (< 30 s),
hors ligne (lecture depuis le cache local), version jouée vs assignée (« en retard »),
fraîcheur des prix (périmé > 1 h), cache réel (fichiers sur l'écran, absents du serveur,
stockage protégé, redémarrage hors ligne possible), disque, dernier contact.

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

### Secteurs d'écrans — gestion par secteur (grands magasins)
Un magasin peut piloter plusieurs **secteurs d'affichage indépendants**, gérés dans **Réseau**.
**Chaque secteur a SA propre configuration d'écrans**, sans aucun impact sur les autres secteurs
ni sur le magasin :

- **Position des écrans** : **portrait** ou **paysage**, choisie par deux boutons dédiés dans la
  ligne du secteur (un aperçu miniature montre l'agencement réel des dalles).
- **Nombre d'écrans** : 1 à 6 par secteur, avec la diagonale d'une dalle (32″ → 85″).
- La **résolution totale** du secteur se recalcule à chaque changement (ex. 3 × portrait =
  6480 × 3840 px · 1 × paysage = 3840 × 2160 px) et s'affiche à côté des réglages.
- **Configuration totalement indépendante** : modifier un secteur ne touche ni les autres
  secteurs ni le format du magasin (couvert par un test dédié dans `test/live-test.js`).

Chaque secteur (`sig_screen_groups`) dit **explicitement ce qu'il filtre**, avec deux bascules :

- **Les périodes** (`filter_moments`, défaut non) : ne montrer que ce qui se vend au moment
  courant (matin / midi / après-midi), d'après les tags de période.
- **Les catégories** (`filter_cats`, défaut oui) : ne montrer que les catégories choisies ;
  la liste ne s'affiche que quand ce filtre est actif.

Un secteur qui **ne filtre rien** suit le film du magasin (comportement d'origine).

- Un **écran** (`sig_players.group_id`) rattaché à un secteur prend **son contenu et son format**
  (menu par écran, dans la fiche magasin) ; un écran sans secteur suit le film du magasin (défaut,
  rétro-compatible).
- Contenu résolu à l'assignation du player, avec les prix, la langue et les jetons du magasin
  (comme la visionneuse). Aperçu d'un secteur : `GET /api/v1/film?group=<id>`.
- Le rendu utilise le canevas 6480 × 3840 mis à l'échelle de l'écran (limite existante de l'app) :
  un secteur dont le combo est proportionnel au mur (ex. 3 × portrait) remplit nativement ; un
  simple écran portrait est mis à l'échelle. API : `POST /stores/{id}/groups`, `POST /groups/{id}`,
  `DELETE /groups/{id}`, `POST /players/{id}/group`.

### Boucle continue — parcourir toute la bibliothèque
Un film ne se monte plus à la main : on pose des règles et la boucle se compose en direct
(**format d'écran**, sources oui/non, ratios « 1 : N » par type, rafraîchissement…).

**Créer une boucle, c'est passer en revue TOUS les éléments de la bibliothèque** au format
d'écran visé. Chaque ligne porte sa **case actif / inactif**, son **ratio de passage** « 1 : N »
(un passage tous les N slots) et un **crayon** qui renvoie à son édition dans la bibliothèque.
Décocher une ligne garde son ratio en mémoire ; cocher une ligne sans ratio lui en donne un
(une case cochée qui ne passe jamais serait un piège silencieux). « Tout activer / Tout
désactiver » ne touche qu'au format affiché : les réglages de l'autre orientation sont intacts.

Stocké dans `continuous.itemRatios` = `[{ id, on, n }]` (l'ancien format `{ id, n }` reste lu :
il vaut « actif si n > 0 »). Un élément tagué par moment ne passe qu'à ces moments-là.

### Suites — le montage à la main dans un film automatique
Le film se compose tout seul, mais certains passages se **montent à la main** : une **intro**,
un **outro**, une **présentation de gamme**… C'est le rôle des **suites** (`sig_sequences`),
éditées dans un mini éditeur au bas du panneau de la boucle.

Une suite est une liste **ordonnée** d'éléments de la bibliothèque (↑ / ↓ pour l'ordre, ✎ pour
éditer l'élément, ✕ pour le retirer). Elle porte :

- son **format d'écran** (16:9 / 9:16) — un élément d'un autre format est signalé sur place,
  il ne passerait pas ;
- sa **place dans la boucle** : **⤒ Ouverture** (en tête de chaque boucle), **⤓ Clôture**
  (en fin), ou **↻ Toutes les N** positions ;
- un état **actif / inactif**.

Chaque film **coche les suites qu'il utilise** (case à gauche de son nom) : une suite est un
objet partagé, mais chaque boucle décide de la jouer ou non. Une suite créée est d'emblée cochée
pour le film en cours d'édition. Les slots générés sont préfixés `k-seq-…` dans la boucle.

### Tags de période — la régie est la seule source
**Tous les paramètres de tag se font dans le back office de la régie.** Quatre familles sont
taguables sur les périodes de la journée (matin / midi / après-midi), avec les mêmes règles et
la même table (`sig_product_moments`, colonne `kind`) :

| Famille | Où se pose le tag | Effet |
| --- | --- | --- |
| **produit** | onglet **Périodes**, table produit × moment | le produit ne passe qu'à ses moments |
| **catégorie** | même table, sur la ligne de la catégorie | hors créneau, elle retire **tous** ses produits ; les tags produits affinent à l'intérieur |
| **promotion** | onglet **Promotions**, sous la fiche du sous-type | une promo hors créneau ne passe pas, même si l'élément qui la porte n'est tagué nulle part |
| **campagne** | onglet **Campagnes**, sous la fiche de la campagne | idem pour les campagnes |

Trois cases par entité, qui cyclent **visible → exclue → vide**. Sans aucune case, l'entité passe
à tous les moments. Une inclusion la restreint à ces moments-là ; une exception retire un moment.

Un **rafraîchissement ERP n'efface pas ce qui a été réglé en régie** : les tags de période
(table à part), les **photos de produits**, les **illustrations de catégories** et l'état
**rupture** sont repris par identifiant d'un import à l'autre — l'ERP fournit le nom, le prix,
la catégorie et l'état actif ; la régie garde le reste. Le compte-rendu d'import indique combien
de visuels ont été conservés.

**Régie → Apparition…** — `GET /api/v1/appearance?product=<id>` renvoie, pour un produit, tout ce
que la régie sait de son passage à l'écran : périodes du produit **et** de sa catégorie, visibilité
à l'instant présent (avec la raison), saisons actives, campagnes liées, éléments de bibliothèque
qui le montrent, secteurs d'écrans où il peut apparaître. C'est **la** lecture destinée à la fiche
produit de l'ERP : la régie règle, l'ERP affiche. Le même résumé s'ouvre en régie avec le bouton
**👁** de la ligne produit (onglet Produits), pour vérifier d'un coup d'œil ce que l'ERP verra.

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

### Vidéo — cadrage à l'écran
Une vidéo n'a presque jamais le format exact du mur d'écrans. Le volet **Vidéo** d'un élément
« film » porte donc son **cadrage** :

- **▭ Adapter (tout voir)** — toute la vidéo est visible, avec des bandes noires si le format
  diffère (`object-fit: contain`).
- **◼ Remplir (recadrer)** — la vidéo couvre l'écran et les bords sont rognés
  (`object-fit: cover`).

Un **pavé de flèches** (← ↑ ↓ →, pas de 120 px sur le canevas 6480 × 3840) choisit la partie
visible, un **zoom** de 0,5× à 4× règle la taille, et **⌖** recentre. Stocké dans
`sig_modules.pos` (`vidX`, `vidY`, `vidZoom`) — aucune migration. La vignette de l'éditeur
applique le même cadrage que l'écran, pour ne pas donner une fausse idée du rendu.

La **couleur de fond** — ce qu'on voit autour de la vidéo quand elle ne remplit pas l'écran — se
choisit dans une liste alimentée par la **palette de la marque** (`BRAND_COLORS`, exportée par
`public/js/renderer.js` : rubis, encre, terre, caramel, or, vert, gris, lin, sable, crème,
blanc). Ajouter une teinte à cette constante la rend disponible partout d'un coup. Un nuancier
« libre » reste là pour un cas particulier ; toute valeur qui n'est pas une couleur est refusée
à l'enregistrement et retombe sur le noir. Champ `sig_modules.bg_color`, appliqué aussi au mode
« fichier » de l'élément Animation, qui a le même besoin.

### Animation — texte animé **ou** fichier importé
L'élément **Animation** travaille de deux façons, choisies dans son volet **Visuel** :

- **Texte animé** (défaut) — titre + accroche générés aux couleurs de la marque, jetons
  `{{magasin}}` & co. compris. On peut y poser un **visuel de fond** (image ou vidéo), avec un
  **voile** réglable (0–90 %) qui garde le texte lisible.
- **Fichier d'animation** — le fichier importé **remplace** le rendu généré : l'élément devient
  un conteneur. Formats : **GIF**, PNG, WebP, **SVG animé**, **MP4 / WebM**, et **Lottie
  (`.json`)**. 18 Mo max par l'upload ; au-delà, déposer dans `public/anim/` sur le serveur.

Dans les deux cas, le **cadrage** est au choix : *Remplir* (couvre l'écran, rogne les bords) ou
*Adapter* (montre tout le fichier). Un fichier peut aussi être désigné par son adresse
(`anim/…`, `media/…`, `https://…`) au lieu d'être importé.

Le lecteur **Lottie** (`public/js/vendor/lottie.js`, lottie-web *light*, MIT) est vendorisé comme
Preact/HTM/QR — aucune dépendance npm — et **chargé à la demande** : tant qu'aucun élément ne
diffuse de `.json`, il n'est pas téléchargé. Un `.json` illisible est refusé à l'upload plutôt que
de laisser un écran vide en magasin. API : `POST /api/v1/anim-assets`, `GET /api/v1/anim-assets`.

### Gabarit HTML (coller du code) + variables
Type d'élément **`html`** : dans la bibliothèque, **＋ Élément → « Gabarit HTML — coller du
code »**. On y colle du HTML (document complet avec `<head><style>` ou simple fragment) ; il est
**mis à l'échelle** sur le canevas 6480 × 3840.

- **Format source** de la maquette (`sig_modules.html_w/html_h`) avec préréglages **16:9 paysage ·
  9:16 portrait · A1 portrait · A1 paysage**, ou dimensions libres. Trois mises en page :
  *Adapter* (tout visible), *Remplir* (recadre), *Étirer*.
- **Variables** : les mêmes jetons que les titres — `{{magasin}}`, `{{adresse}}`, `{{horaires}}`,
  `{{tel}}`, `{{date}}`, `{{saison}}`, `{{moment}}` — sont résolus **dans le code** et **par
  magasin** à la diffusion (`applyStoreTokens`). Boutons cliquables pour les insérer au curseur.
- Bouton **« ✨ Affiche A1 (exemple) »** : charge un gabarit d'affiche prêt à l'emploi. Les polices
  **Gotham/Vank** et les images de `assets/` sont déjà chargées — pas besoin de `@font-face`.
- **Sécurité** : `splitHtmlDoc` extrait styles + corps, `sanitizeHtml` retire `<script>`, les
  gestionnaires `on*` et les URL `javascript:` (le code vient de la régie, admin authentifiée).

### Règle photo / illustration
Un **produit** porte une **photo** (`sig_products.img`) ; une **catégorie** porte une
**illustration** (`sig_product_categories.img`, saisie dans l'onglet Produits en sélectionnant la
catégorie). L'écran « catégorie » affiche l'**illustration de la catégorie** quand elle est
renseignée, et retombe sinon sur la photo du produit courant (comportement d'origine, donc
rétro-compatible). Les deux sont exposées séparément aux variables d'un gabarit HTML.

### Format des items (16:9 / 9:16) — filtre de montage
Un écran est **soit paysage, soit portrait** : chaque élément porte donc un **format de diffusion**
(`sig_modules.orient`) valant **`paysage`** (16:9, défaut) ou **`portrait`** (9:16) — il n'y a pas
d'entre-deux. Ce format sert de **filtre des items disponibles** au montage : la bibliothèque et la
ligne du temps ne proposent que les éléments du format visé (les deux vues sont **disjointes**).
Sur un **gabarit HTML**, choisir un préréglage 16:9 / 9:16 fixe directement le format de l'item.

### Variables d'un gabarit HTML — détectées et liées aux données
Chaque **`{{ variable }}`** présente dans le code collé est **détectée et remontée** dans le volet
« Code HTML » (les espaces sont tolérés : `{{ titre }}` = `{{titre}}`). Pour chacune, on choisit une
**source de données** et le **champ** à afficher — la substitution a lieu **par magasin, à la
diffusion** (`applyHtmlVars`, juste avant les jetons magasin) :

| Source | Champs |
|---|---|
| **Valeur libre** | texte saisi |
| **Produit** | nom · prix (celui du magasin s'il existe) · **photo** · catégorie |
| **Catégorie** | nom · **illustration** |
| **Promotion** | nom du type · icône · couleur · description |
| **Campagne** | nom · accroche · thème · visuel · couleur · date de début / de fin |
| **Magasin / contexte** | nom · adresse · horaires · téléphone · date du jour · période active · moment |

Les **constantes d'identité de marque** — `{{ logo }}`, `{{ logoBlanc }}` — sont résolues **d'office,
sans liaison** (une liaison explicite reste prioritaire). Une source **Image / marque** permet de
pointer les autres visuels (`{{ filigrane }}`, `{{ illustration }}`…) sur les images livrées.

**Placer une variable à l'écran** : cliquer sa pastille ouvre son placement — flèches, curseurs X/Y
(px de la maquette) et « Recentrer ». Deux cas, tous deux pris en charge en aperçu comme à la
diffusion : une variable **en position de texte** voit sa valeur enrobée dans un span translaté ;
une variable **dans un attribut** (`src="{{ illustration }}"`) ne peut pas être enrobée sans casser
le HTML, alors la translation est portée par **la balise elle-même** (`applyHtmlVarPositions`, passe
faite avant la substitution) — le style d'origine de la balise est préservé, la déclaration ajoutée
en dernier l'emportant sur un `transform` existant.

Une variable **laissée non liée** retombe sur les jetons standards (`{{magasin}}`, `{{date}}`…) ou
reste visible telle quelle — rien n'est inventé. Une variable d'image non liée est neutralisée à
l'affichage (pas d'image cassée). Liaisons et placements sont stockés dans `sig_modules.html_vars`
(JSON). L'**aperçu du compositeur** applique les liaisons en direct (`resolveHtmlPreview`) ; les
champs propres à un magasin s'y affichent en repère `‹Nom du magasin›` tant qu'aucun magasin n'est
choisi.

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

**Matières premières** (`sig_ingredients`) : chaque ingrédient peut être **lié à une animation**
de la bibliothèque — c'est ce lien que le module produit du franchiseur (Produit → Ingrédient)
vient lire (`GET /api/v1/ingredients`). Le réglage se fait ici : la régie est la seule source.
La **référence ERP** est optionnelle et rapproche les deux mondes sans dépendre du nom ; une
animation supprimée de la bibliothèque laisse un lien signalé « animation supprimée ».
Le bouton **🔎 Diagnostic ERP** cherche la table des ingrédients dans la base de l'ERP
(`POST /api/v1/ingredients/inspect`, lecture seule — rien n'est importé).

**Catégories de la bibliothèque** (`sig_lib_categories`) : le classement des éléments s'édite ici
— nom, couleur, ordre, actif/inactif, et la **table de la régie** qui alimente la catégorie
(produits, catégories produit, promotions, campagnes, périodes, médiathèque). Rien n'est écrit en
dur dans l'interface. Une catégorie inactive n'est plus proposée au classement, mais les éléments
qui la portent restent visibles ; la liste ne peut pas être vidée.

## Tests

```bash
npm test              # serveur jetable (BDD temporaire) + cycle complet — 72 tests
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
                 GET /lib-categories · PUT /lib-categories (classement + table liée)
                 GET /ingredients · PUT /ingredients (matière première ↔ animation)
                 POST /anim-assets · GET /anim-assets (fichiers d'animation)
                 GET /sequences · PUT /sequences (suites : intro · outro · gamme)
                 GET /product-moments · PUT /product-moments (tags de période,
                   kind = produit | categorie | promotion | campagne)
                 GET /appearance?product={id} (Régie → Apparition…, lecture ERP)
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
