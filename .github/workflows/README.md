# CI et déploiement

## Job `test`

Tourne sur chaque push et chaque pull request, sans aucun secret :

1. rejoue migrations et seeds sur un **MySQL 8** de service — c'est la validation sur le moteur cible, l'environnement de développement n'ayant permis qu'un MariaDB 10.11 ;
2. relance le runner une seconde fois pour vérifier qu'un redéploiement sur base déjà migrée ne casse rien ;
3. échoue si une table échappe au préfixe `mar_` ;
4. lint PHP, tests de l'API, typecheck et build du front.

## Job `deploy`

Ne part que sur un push vers `main` (ou un `Run workflow` manuel), après le job `test`.

Ordre voulu : API et migrations d'abord, front en dernier. Si une migration échoue, les utilisateurs restent sur la version précédente au lieu de tomber sur une interface dont le schéma manque.

### Secrets à configurer

Dans **Settings → Secrets and variables → Actions**. Ce sont les **mêmes noms que `back_office_ws_franchisor`**, qui se déploie déjà sur ce serveur : un dépôt de plus ne doit pas inventer sa propre convention.

| Secret | Rôle |
|---|---|
| `SSH_HOST` | Hôte du serveur, ex. `185.180.206.46` |
| `SSH_USER` | Utilisateur SSH |
| `SSH_PASSWORD` | Mot de passe de cet utilisateur |
| `SSH_KEY` | *(alternative)* clé privée de déploiement |

`SSH_KEY` et `SSH_PASSWORD` sont exclusifs : si les deux existent, la clé est utilisée. Le commentaire de `deploy.yml` dans `back_office_ws_franchisor` recommande lui-même la clé plutôt que le mot de passe root — c'est le chemin d'amélioration, sans rien casser en attendant.

**Sans `SSH_HOST` ni `SSH_USER`, le déploiement est sauté et le run reste vert.** Un dépôt pas encore branché ne doit pas afficher un échec permanent, qui finit par être ignoré. Le résumé du run indique alors ce qui manque.

### Variables (pas des secrets)

Dans **Settings → Secrets and variables → Actions → Variables**. Ces chemins n'ont rien de sensible, et les mettre en secrets les rendrait illisibles dans les logs pour rien.

| Variable | Valeur si l'application est servie sous `/marketing` |
|---|---|
| `SSH_PORT` | Port SSH, défaut `22` |
| `DEPLOY_DIR` | Répertoire serveur, défaut `/var/www/html/webshop/marketing` |
| `VITE_BASE` | Préfixe des URL d'assets — le chemin URL de `DEPLOY_DIR`, ex. `/webshop/marketing/`. Laissée vide, le JS et le CSS répondent 404 dès que la page ne vit pas à la racine du domaine. |
| `VITE_API_BASE` | Préfixe des appels à l'API, ex. `/webshop/marketing`. Vide, ils partent à la racine du domaine et tombent à côté. |

`DEPLOY_DIR` suit la convention existante : `/var/www/html/webshop/backoffice_franchisor` est servi à `http://<hôte>/webshop/backoffice_franchisor`. La racine web est donc `/var/www/html`, et `VITE_BASE` est simplement `DEPLOY_DIR` sans ce préfixe.

Les deux sont vides par défaut, ce qui vise la racine — correct pour un déploiement qui n'est pas en sous-répertoire.

### Connexion à la base côté serveur

Les identifiants sont évidemment nécessaires — pour créer les tables comme pour écrire dedans. Ils ne passent simplement pas par GitHub : `db/migrate.php` s'exécute **sur le serveur**, appelé par SSH, et l'API y tourne en permanence.

Ils vivent dans un fichier **`.env` placé un cran au-dessus de `DEPLOY_DIR`**, donc hors de la racine web. C'est délibéré : `DEPLOY_DIR` est servi par le serveur web, et un `.env` posé dedans serait téléchargeable — identifiants MySQL compris. Deux façons de l'obtenir, au choix :

**A — par GitHub (automatique).** Ajoutez ces secrets ; le déploiement (ré)écrit le fichier à chaque passage, en `chmod 600` :

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

L'API cherche le fichier dans cet ordre, premier lisible gagnant : `MAR_ENV_FILE`, puis le parent de `DEPLOY_DIR`, puis `DEPLOY_DIR` lui-même. La troisième position n'est tolérée que pour ne pas casser une installation existante ; `api/.htaccess` et `db/.htaccess` y refusent les fichiers commençant par un point, ainsi que le code PHP et les migrations. Ces règles supposent `AllowOverride` actif — si ce n'est pas le cas sur ce vhost, la seule protection réelle est l'emplacement du fichier.

## À adapter

Le déploiement est écrit en `rsync` sur SSH, la méthode la plus courante. Si votre chaîne diffère (conteneur, FTP, agent de déploiement, dépôt Git côté serveur), seules les trois dernières étapes du job `deploy` changent — le job `test` reste valable.
