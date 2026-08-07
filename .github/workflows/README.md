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

### Connexion à la base côté serveur

`db/migrate.php` lit sa connexion dans l'environnement du serveur : `MAR_DB_HOST`/`MAR_DB_PORT` (ou `MAR_DB_SOCKET`), puis `MAR_DB_NAME`, `MAR_DB_USER`, `MAR_DB_PASSWORD`. Ces valeurs vivent côté serveur, pas dans les secrets GitHub — la CI n'a jamais besoin des identifiants de base.

## À adapter

Le déploiement est écrit en `rsync` sur SSH, la méthode la plus courante. Si votre chaîne diffère (conteneur, FTP, agent de déploiement, dépôt Git côté serveur), seules les trois dernières étapes du job `deploy` changent — le job `test` reste valable.
