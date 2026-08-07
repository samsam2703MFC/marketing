# Préparation du serveur — à faire une fois

Cible : `185.180.206.46`, application servie à `http://185.180.206.46/marketing`.

Hypothèses, à ajuster si votre installation diffère : racine web `/var/www/html`, Apache, PHP déjà actif sur cet hôte (votre `api-config.js` sert déjà une API PHP same-origin, donc c'est le cas).

---

## 1. Répertoires

```bash
sudo mkdir -p /var/www/html/marketing
sudo mkdir -p /var/www/private/marketing

# Le déploiement écrit dans le premier ; le second ne contient que la config.
sudo chown -R "$USER":www-data /var/www/html/marketing /var/www/private/marketing
sudo chmod 750 /var/www/private/marketing
```

`/var/www/private` est **hors racine web** : c'est ce qui empêche le `.env` d'être téléchargeable. Ne le déplacez pas sous `/var/www/html`.

---

## 2. Base MySQL

```sql
CREATE DATABASE marketing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'marketing'@'localhost' IDENTIFIED BY 'REMPLACER_PAR_UN_MOT_DE_PASSE';
GRANT ALL PRIVILEGES ON marketing.* TO 'marketing'@'localhost';
FLUSH PRIVILEGES;
```

Le module a besoin de `CREATE`, `ALTER` et `DROP` : il crée ses 54 tables et ses 6 vues lui-même, via `db/migrate.php`. Le schéma exige **MySQL 5.7 ou plus** (type `JSON`) ; le runner vérifie la version et refuse de démarrer en dessous plutôt que de laisser une base à moitié créée.

---

## 3. Configuration

À faire uniquement si vous n'avez pas mis `MAR_DB_NAME` / `MAR_DB_USER` / `MAR_DB_PASSWORD` en secrets GitHub — dans ce cas le déploiement écrit ce fichier tout seul.

```bash
sudo tee /var/www/private/marketing/.env > /dev/null <<'EOF'
MAR_DB_HOST="127.0.0.1"
MAR_DB_PORT="3306"
MAR_DB_NAME="marketing"
MAR_DB_USER="marketing"
MAR_DB_PASSWORD="REMPLACER_PAR_UN_MOT_DE_PASSE"
EOF
sudo chmod 600 /var/www/private/marketing/.env
sudo chown "$USER":www-data /var/www/private/marketing/.env

# Pointeur lu par l'API — ne contient qu'un chemin, aucun secret.
echo /var/www/private/marketing/.env | sudo tee /var/www/html/marketing/api/.env-path > /dev/null
```

Les guillemets ne sont pas décoratifs : un mot de passe contenant des espaces en bordure ou lui-même entouré de guillemets serait tronqué sans eux, et l'authentification MySQL échouerait sans message exploitable.

---

## 4. Apache

```bash
sudo a2enmod rewrite
```

### Variante A — la plus simple

Les règles voyagent déjà avec l'application (`public/.htaccess` est livré dans le build). Il suffit d'autoriser leur lecture :

```apache
<Directory /var/www/html/marketing>
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
```

### Variante B — si `AllowOverride` doit rester à `None`

Mêmes règles, posées directement dans la configuration du site :

```apache
<Directory /var/www/html/marketing>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted

    RewriteEngine On
    RewriteBase /marketing/

    # Les appels API partent vers le contrôleur frontal du module.
    # La réécriture ne modifie pas REQUEST_URI : PHP y retrouve le chemin
    # d'origine et en retire lui-même le préfixe /marketing.
    RewriteRule ^api/(.*)$ api/public/index.php [L,QSA]

    # Fichier ou répertoire réel : servi tel quel.
    RewriteCond %{REQUEST_FILENAME} -f [OR]
    RewriteCond %{REQUEST_FILENAME} -d
    RewriteRule ^ - [L]

    # Sinon l'application, qui gère son propre routage.
    RewriteRule ^ index.html [L]
</Directory>

# Sources PHP : seul le contrôleur frontal est atteignable.
<Directory /var/www/html/marketing/api>
    <FilesMatch "^(?!index\.php$).*\.php$">
        Require all denied
    </FilesMatch>
    <FilesMatch "^\.|\.(sql|md|json|lock)$">
        Require all denied
    </FilesMatch>
</Directory>

# Les migrations décrivent tout le schéma : rien à servir ici.
<Directory /var/www/html/marketing/db>
    Require all denied
</Directory>
```

Puis :

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

---

## 5. Vérification

Après le premier déploiement, sur le serveur :

```bash
BASE=http://localhost/marketing

# La page doit répondre 200
curl -s -o /dev/null -w 'page          %{http_code}\n' "$BASE/"

# L'API doit répondre 401 : elle est joignable et refuse l'accès sans jeton.
# Un 404 signifie que la réécriture n'est pas active.
curl -s -o /dev/null -w 'api           %{http_code}  (401 attendu)\n' \
  "$BASE/api/v1/marketing/references"

# Ces trois-là ne doivent PAS répondre 200.
curl -s -o /dev/null -w 'config        %{http_code}  (403/404 attendu)\n' "$BASE/.env"
curl -s -o /dev/null -w 'pointeur      %{http_code}  (403/404 attendu)\n' "$BASE/api/.env-path"
curl -s -o /dev/null -w 'migration     %{http_code}  (403/404 attendu)\n' \
  "$BASE/db/migrations/001_socle_reseau.sql"
```

Les trois derniers comptent autant que les deux premiers : un `200` sur `.env` signifie que les identifiants MySQL sont publics.

---

## 6. Ce que le compte SSH doit pouvoir faire

Le déploiement, sous l'utilisateur de `SSH_USER` :

- écrire dans `/var/www/html/marketing` et `/var/www/private/marketing` ;
- exécuter `php` (pour `db/migrate.php`) ;
- disposer de `rsync`.

```bash
command -v rsync php || sudo apt-get install -y rsync php-cli php-mysql
```

`php-mysql` fournit `pdo_mysql`, sans lequel les migrations ne peuvent pas s'exécuter.
