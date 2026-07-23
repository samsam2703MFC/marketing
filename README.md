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
| `http://localhost:8080/` | Back office (connexion → Compositeur · Flotte · Paramètres) |
| `http://localhost:8080/film` | **Visionneuse publique du film** — dernière playlist publiée, plein écran, sans connexion |
| `http://localhost:8080/player.html?id=p1&token=plyr_9F3A2C7E` | Player d'exemple (magasin Centre-Ville) |
| `http://localhost:8080/api/v1/health` | Sonde de santé (publique) |

Variables : `PORT` (défaut 8080), `HOST`, `SIG_DB` (chemin SQLite, défaut `data/signage.db`),
`SIG_ADMIN_PASSWORD` (mot de passe du compte `admin`, appliqué à chaque démarrage),
`BASE_PATH` (chemin public si l'app est montée sous un sous-chemin, ex. `/pwa_consultant/signage`).
Au premier démarrage la base est créée et **seedée** avec le contenu de la maquette
(catégorie *Tartes* 8 produits, liaison *Fait maison*, 3 magasins / 5 écrans de démo).

## Déploiement sur http://185.180.206.46/pwa_consultant/signage/

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
#    montent l'app sous /pwa_consultant/signage/

# 4) Tests live post-déploiement, depuis n'importe où :
node test/live-test.js http://185.180.206.46/pwa_consultant/signage --password=VOTREMDP
node test/live-test.js http://185.180.206.46/pwa_consultant/signage --password=VOTREMDP --mutate
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

### Compositeur
Playlist (drag & drop, retrait sans suppression), bibliothèque (copier / dupliquer / supprimer),
tag campagne, programmation (jours + fenêtre horaire), 7 mises en page, mouvement par élément,
positions fines (curseurs **et** glisser-déposer directement sur l'aperçu), produits & tarifs
(illustration ou photo importée), aperçu animé 6480 × 3840 avec transport (lecture, boucle,
durée par ligne, scope module / playlist). Annuler / rétablir (⌘Z / ⌘⇧Z), espace = lecture/pause.

**Enregistrer** pousse le brouillon dans la base (`PUT /api/v1/draft`).

### Publication (versionnée, atomique) + tests live
« Publier sur la flotte » crée un **snapshot** en base :

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
le voir apparaître dans la flotte. Dans la vue Flotte, cliquer le nom d'un écran (↗) ouvre son player.

### Flotte & supervision
KPIs, alertes, état par magasin / écran depuis les vrais heartbeats : en ligne (< 30 s),
hors ligne (lecture depuis le cache local), version jouée vs assignée (« en retard »),
fraîcheur des prix (périmé > 1 h), cache, disque, dernier contact.

### Paramètres
URL du CMS, IP / hôte player, token — persistés en base. **« Tester la connexion (live) »**
exécute côté serveur : ping TCP de l'hôte, `GET assignment`, `GET dataset prix`,
`POST heartbeat` (dry-run), avec latences réelles.

## Tests

```bash
npm test              # serveur jetable (BDD temporaire) + cycle complet — 16 tests
npm run test:live     # lecture seule contre http://localhost:8080 (ou BASE_URL / 1er argument)
npm run test:live:full            # cycle complet contre l'instance courante (publie réellement)
node test/live-test.js http://185.180.206.46/pwa_consultant/signage --password=… --mutate
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
