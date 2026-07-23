# Régie d'affichage — L'Atelier By (module signage)

Back office de pilotage du signage (implémentation de la maquette **Back Office.dc.html**),
avec CMS, base de données, player d'écran et **tests live exécutés à chaque déploiement**.

- **Zéro dépendance** : Node.js ≥ 22.5 uniquement (`node:http` + `node:sqlite`). Pas de `npm install`.
- **Base SQLite** : toutes les tables sont préfixées **`sig_`** (`sig_modules`, `sig_module_items`,
  `sig_playlist`, `sig_stores`, `sig_players`, `sig_snapshots`, `sig_publications`,
  `sig_heartbeats`, `sig_settings`).
- **Front** : Preact + HTM embarqués (`public/js/vendor/`), aucun build.

## Démarrer

```bash
npm start            # ou : node server/index.js
```

| URL | Rôle |
|---|---|
| `http://localhost:8080/` | Back office (Compositeur · Flotte & supervision · Paramètres) |
| `http://localhost:8080/player.html?id=p1&token=plyr_9F3A2C7E` | Player d'exemple (magasin Centre-Ville) |
| `http://localhost:8080/api/v1/health` | Sonde de santé |

Variables : `PORT` (défaut 8080), `HOST`, `SIG_DB` (chemin SQLite, défaut `data/signage.db`).
Au premier démarrage la base est créée et **seedée** avec le contenu de la maquette
(catégorie *Tartes* 8 produits, liaison *Fait maison*, 3 magasins / 5 écrans de démo).

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
npm test              # serveur jetable (BDD temporaire) + cycle complet — 14 tests
npm run test:live     # lecture seule contre http://localhost:8080 (ou BASE_URL / 1er argument)
npm run test:live:full            # cycle complet contre l'instance courante (publie réellement)
node test/live-test.js https://cms.example.com --mutate   # après déploiement, en CI/CD
```

Le runner sort avec un code ≠ 0 si un test échoue — à brancher en post-deploy.

## API (extrait)

```
GET  /api/v1/health                        GET  /api/v1/state
PUT  /api/v1/draft                         GET  /api/v1/fleet
POST /api/v1/publish                       POST /api/v1/push-prices
POST /api/v1/override                      POST /api/v1/test
GET  /api/v1/publications                  POST /api/v1/settings
GET  /api/v1/players/{id}/assignment?token=…
POST /api/v1/players/{id}/heartbeat
GET  /api/v1/datasets/latest?token=…       GET  /api/v1/snapshots/{version}?token=…
```

## Notes

- Le back office est prévu pour un réseau interne / ERP : pas d'authentification sur l'UI
  (les endpoints player sont, eux, protégés par token). À placer derrière le SSO/reverse-proxy
  de l'ERP si exposé.
- Les photos importées sont stockées en dataURL dans `sig_module_items.img` (simple et
  autonome ; migrer vers un stockage fichier si les volumes grossissent).
- Polices : sous-ensemble Gotham (300/400/500·600/700+) + Vank, servies depuis `public/fonts/`.
