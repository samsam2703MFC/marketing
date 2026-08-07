# CI et déploiement

## Job `test`

Tourne sur chaque push et chaque pull request, sans aucun secret :

1. rejoue migrations et seeds sur un **MySQL 8** de service — c'est la validation sur le moteur cible, l'environnement de développement n'ayant permis qu'un MariaDB 10.11 ;
2. relance le runner une seconde fois pour vérifier qu'un redéploiement sur base déjà migrée ne casse rien ;
3. échoue si une table échappe au préfixe `mar_` ;
4. lint PHP, tests de l'API, typecheck et build du front.

## Job `deploy`

Ne part que sur un push vers `main`, après le job `test`, et passe par l'environnement GitHub `production` — vous pouvez y exiger une approbation manuelle.

Ordre voulu : API et migrations d'abord, front en dernier. Si une migration échoue, les utilisateurs restent sur la version précédente au lieu de tomber sur une interface dont le schéma manque.

### Secrets à configurer

Dans **Settings → Environments → production → Secrets** :

| Secret | Rôle |
|---|---|
| `DEPLOY_HOST` | Hôte du serveur |
| `DEPLOY_USER` | Utilisateur SSH |
| `DEPLOY_SSH_KEY` | Clé privée de déploiement (clé dédiée, pas une clé personnelle) |
| `DEPLOY_KNOWN_HOSTS` | Sortie de `ssh-keyscan <hôte>` |
| `DEPLOY_PATH` | Racine de déploiement sur le serveur |

Le job s'arrête net si l'un des quatre premiers manque, plutôt que d'échouer à mi-parcours sur un déploiement partiel.

`DEPLOY_KNOWN_HOSTS` n'est pas optionnel : sans empreinte d'hôte, la connexion accepterait n'importe quel serveur répondant à cette adresse.

La clé de déploiement doit être **dédiée à ce dépôt** et restreinte au chemin de déploiement. Ne collez jamais une clé ou un mot de passe dans une conversation ou un fichier du dépôt — seuls les secrets GitHub sont un endroit correct.

### Variables (pas des secrets)

Dans **Settings → Secrets and variables → Actions → Variables**. Ces chemins n'ont rien de sensible, et les mettre en secrets les rendrait illisibles dans les logs pour rien.

| Variable | Valeur si l'application est servie sous `/marketing` |
|---|---|
| `VITE_BASE` | `/marketing/` — préfixe des URL d'assets. Laissée vide, le JS et le CSS répondent 404 dès que la page ne vit pas à la racine du domaine. |
| `VITE_API_BASE` | `/marketing` — préfixe des appels à l'API. Vide, ils partent à la racine du domaine et tombent à côté. |

Les deux sont vides par défaut, ce qui vise la racine — correct pour un déploiement qui n'est pas en sous-répertoire.

### Connexion à la base côté serveur

Les identifiants sont évidemment nécessaires — pour créer les tables comme pour écrire dedans. Ils ne passent simplement pas par GitHub : `db/migrate.php` s'exécute **sur le serveur**, appelé par SSH, et l'API y tourne en permanence.

Ils vivent dans un fichier **`.env` à la racine du déploiement** (`$DEPLOY_PATH/.env`). Deux façons de l'obtenir, au choix :

**A — par GitHub (automatique).** Ajoutez ces secrets à l'environnement `production` ; le déploiement (ré)écrit le fichier à chaque passage, en `chmod 600` :

| Secret | Défaut si absent |
|---|---|
| `MAR_DB_NAME` | — obligatoire pour activer ce mode |
| `MAR_DB_USER` | — |
| `MAR_DB_PASSWORD` | — |
| `MAR_DB_HOST` | `127.0.0.1` |
| `MAR_DB_PORT` | `3306` |

**B — à la main (par défaut).** Sans `MAR_DB_NAME`, l'étape est sautée et le fichier que vous avez posé sur le serveur reste intact :

```
MAR_DB_HOST=127.0.0.1
MAR_DB_NAME=marketing
MAR_DB_USER=…
MAR_DB_PASSWORD=…
```

Le mode A évite l'étape manuelle et rend une reconstruction du serveur reproductible ; en échange, les identifiants existent à deux endroits, et toute personne administratrice du dépôt peut les remplacer. Le mode B les garde sur la seule machine qui en a besoin.

En mode A, le fichier est composé dans le runner puis transféré — jamais assemblé dans une commande distante, qui ferait apparaître le mot de passe dans la liste des processus du serveur. Chaque valeur part entre guillemets et échappée : sans cela, un mot de passe bordé d'espaces ou déjà entouré de guillemets serait tronqué à la relecture, et l'authentification échouerait sans indice. Le trajet aller-retour est couvert par les tests.

Un fichier plutôt que des variables exportées dans un profil de shell, parce qu'aucun des deux consommateurs ne les verrait : `ssh user@host "php db/migrate.php"` ouvre une session **non interactive**, qui ne charge pas `~/.bashrc`, et l'API tourne sous PHP-FPM, dont l'environnement vient de la configuration du pool. Les variables réellement présentes dans l'environnement restent prioritaires sur le fichier.

Le fichier se place au-dessus de la racine web (`api/public`), donc il n'est pas servi. Le déploiement ne le touche jamais : `rsync` ne pousse que `api/` et `db/`.

## À adapter

Le déploiement est écrit en `rsync` sur SSH, la méthode la plus courante. Si votre chaîne diffère (conteneur, FTP, agent de déploiement, dépôt Git côté serveur), seules les trois dernières étapes du job `deploy` changent — le job `test` reste valable.
