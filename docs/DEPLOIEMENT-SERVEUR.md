# Préparation du serveur — à faire une fois

Cible : `185.180.206.46`, application servie à `http://185.180.206.46/marketing`.

Hypothèses, à ajuster si votre installation diffère : racine web `/var/www/html`, Apache, PHP déjà actif sur cet hôte (votre `api-config.js` sert déjà une API PHP same-origin, donc c'est le cas).

---

## 1. Répertoires

Deux applications distinctes, donc deux répertoires : la vue Réseau (franchiseur) et la vue Franchisé sont des builds séparés, chacun avec sa navigation et ses libellés. Le rôle est figé à la compilation, il n'y a pas de bascule à l'écran.

| Vue | Répertoire | URL |
|---|---|---|
| Réseau (franchiseur) | `/var/www/html/marketing` | `/marketing/?brand=1` |
| Franchisé | `/var/www/html/marketingc` | `/marketingc/?brand=1` |

L'enseigne du périmètre se lit dans l'adresse : `?brand=1` porte **l'identifiant
de l'ERP**, pas celui du module. C'est l'ERP qui ouvre le module, et il ne
connaît que ses propres numéros ; la correspondance est établie par la reprise,
qui inscrit cet identifiant dans `mar_brand.erp_brand_id`. Le module n'offre
donc aucun sélecteur de marque — il en offrait un, et travailler une heure sur
l'enseigne du voisin sans s'en apercevoir y était possible.

Une adresse sans `brand` n'applique aucun filtre, ce qui convient à un réseau
mono-enseigne. Une adresse qui nomme une enseigne inconnue affiche un message
et rien d'autre : remplir les écrans d'un périmètre que personne n'a demandé
serait pire.

```bash
sudo mkdir -p /var/www/html/marketing /var/www/html/marketingc
sudo mkdir -p /var/www/private/marketing

# Le déploiement écrit dans le premier ; le second ne contient que la config.
sudo chown -R "$USER":www-data /var/www/html/marketing /var/www/html/marketingc /var/www/private/marketing
sudo chmod 750 /var/www/private/marketing
```

`/var/www/private` est **hors racine web** : c'est ce qui empêche le `.env` d'être téléchargeable. Ne le déplacez pas sous `/var/www/html`.

---

## 2. Base MySQL

**Pas de nouvelle base.** Les tables du module vont dans `atelier_db`, aux côtés de celles de l'ERP. C'est tout l'intérêt du préfixe `mar_` : les 54 tables et 6 vues du module s'y reconnaissent au premier coup d'œil et ne peuvent entrer en collision avec rien.

Rien à créer, donc — seulement des droits, si l'utilisateur MySQL du module n'est pas déjà celui de l'ERP :

```sql
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW
  ON atelier_db.* TO 'VOTRE_UTILISATEUR'@'localhost';
FLUSH PRIVILEGES;
```

`CREATE`, `ALTER`, `DROP` et `CREATE VIEW` sont nécessaires : `db/migrate.php` crée lui-même les tables et les vues du module.

⚠️ **À savoir avant de créer un utilisateur dédié.** MySQL ne sait pas restreindre des droits à un préfixe de tables : accorder `DROP` sur `atelier_db.*` le donne aussi sur les tables de l'ERP. Si cela vous gêne, réutilisez l'utilisateur MySQL existant de l'ERP plutôt que d'en ajouter un second aux mêmes pouvoirs — vous n'élargirez pas la surface.

Le schéma exige **MySQL 5.7 ou plus** (type `JSON`). Le runner vérifie la version et refuse de démarrer en dessous, plutôt que d'échouer à mi-parcours en laissant des tables à moitié créées.

Vérifié sur MySQL 8.0.46 : migration dans une base contenant déjà des tables non préfixées, 61 objets `mar_` créés, tables voisines et leurs données intactes.

## 3. Configuration

À faire uniquement si vous n'avez pas mis `MAR_DB_NAME` / `MAR_DB_USER` / `MAR_DB_PASSWORD` en secrets GitHub — dans ce cas le déploiement écrit ce fichier tout seul.

```bash
sudo tee /var/www/private/marketing/.env > /dev/null <<'EOF'
MAR_DB_HOST="127.0.0.1"
MAR_DB_PORT="3306"
MAR_DB_NAME="atelier_db"
MAR_DB_USER="VOTRE_UTILISATEUR"
MAR_DB_PASSWORD="REMPLACER_PAR_UN_MOT_DE_PASSE"
EOF
# 640 et groupe www-data : le fichier est écrit par le compte de déploiement
# mais lu par PHP sous www-data. En 600 appartenant à root, l'API ne peut pas
# l'ouvrir, et rien ne le signale avant le premier appel qui touche la base.
sudo chown root:www-data /var/www/private/marketing/.env
sudo chmod 640 /var/www/private/marketing/.env

# Pointeur lu par l'API — ne contient qu'un chemin, aucun secret.
echo /var/www/private/marketing/.env | sudo tee /var/www/html/marketing/api/.env-path > /dev/null
```

Contrôle utile : `sudo -u www-data test -r /var/www/private/marketing/.env && echo lisible`.

Les guillemets ne sont pas décoratifs : un mot de passe contenant des espaces en bordure ou lui-même entouré de guillemets serait tronqué sans eux, et l'authentification MySQL échouerait sans message exploitable.

---

## 4. Apache

```bash
sudo a2enmod rewrite
```

### Variante A — la plus simple

Les règles voyagent déjà avec l'application (`public/.htaccess` est livré dans le build). Il suffit d'autoriser leur lecture.

**Cette configuration s'écrit dans un fichier — ne la collez pas dans le shell**, il la prendrait pour des commandes. La commande ci-dessous crée le fichier pour vous :

```bash
sudo tee /etc/apache2/conf-available/marketing.conf > /dev/null <<'EOF'
<Directory /var/www/html/marketing>
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

<Directory /var/www/html/marketingc>
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
EOF

sudo a2enconf marketing
```

Les deux blocs sont identiques : chaque répertoire embarque son propre `.htaccess`, livré avec son build.

### Variante B — si `AllowOverride` doit rester à `None`

Mêmes règles, écrites en dur dans la configuration. Même remarque : c'est une commande complète, à coller telle quelle.

```bash
sudo tee /etc/apache2/conf-available/marketing.conf > /dev/null <<'EOF'
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
EOF

sudo a2enconf marketing
```

Puis :

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

---

## 5. Vérification

**À faire après le premier déploiement, pas avant.** Sur un répertoire encore vide, `page 200` ne veut rien dire : c'est un listing de répertoire, pas l'application. Et les trois `404` restants sont ceux de fichiers qui n'existent pas encore, pas la preuve qu'ils sont protégés.

Sur le serveur :

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

# Et la vue Franchisé, qui est une application à part entière.
F=http://localhost/marketingc
curl -s -o /dev/null -w 'franchisé     %{http_code}\n' "$F/"
curl -s -o /dev/null -w 'franchisé api %{http_code}\n' "$F/api/v1/marketing/session"
```

Les trois derniers comptent autant que les deux premiers : un `200` sur `.env` signifie que les identifiants MySQL sont publics.

---

## 6. Ce que le compte SSH doit pouvoir faire

Le déploiement, sous l'utilisateur de `SSH_USER` :

- écrire dans `/var/www/html/marketing` et `/var/www/private/marketing` ;
- exécuter `php` (pour `db/migrate.php`) ;
- disposer de `rsync`.

```bash
sudo apt-get install -y rsync php-cli php-mysql
php -m | grep -i pdo_mysql   # doit afficher pdo_mysql
```

⚠️ Ne remplacez pas cette ligne par un test groupé du genre `command -v rsync php || apt-get install …` : si `rsync` et `php` sont déjà présents, le test réussit, l'installation est court-circuitée et **`php-mysql` n'est jamais posé**. Les migrations échouent alors bien plus tard, sur une extension manquante.

`php-mysql` fournit `pdo_mysql`, sans lequel `db/migrate.php` ne peut pas se connecter. Le contrôle `php -m` ci-dessus est la seule preuve qui compte.

## Reprise depuis l'ERP

Les boutiques et les comptes professionnels ne se saisissent pas dans le module :
ils appartiennent à l'ERP. La reprise se lance depuis **Fidélité & CRM**, et elle
est rejouable — elle met à jour les fiches connues, n'ajoute que les nouvelles.

Les tables lues sont, par défaut, celles de cette installation :

| Notion              | Table                            |
|---------------------|----------------------------------|
| Boutiques           | `franchisee_shop`                |
| Clients             | `client`                         |
| Secteurs visés      | `b2b_client_type`                |
| Liaison compte ↔ secteur | `b2b_client_interest_connection` |

Elles sont cherchées dans la base du module — ici `atelier_db`, qui héberge
aussi l'ERP. Quatre variables du `.env` permettent d'en désigner d'autres, sous
la forme `table` ou `schéma.table` :

```
MAR_ERP_SHOPS_TABLE=franchisee_shop
MAR_ERP_CUSTOMERS_TABLE=client
MAR_ERP_SECTORS_TABLE=b2b_client_type
MAR_ERP_SECTOR_LINK_TABLE=b2b_client_interest_connection
```

Les colonnes de la table de liaison font exception à la découverte
automatique : ici elles s'appellent `id_b2b_client` et `id_interest`, sans
contrainte déclarée ni convention `id_<table>` qui dise vers quoi elles
pointent. Elles sont reconnues par une liste de noms connus, et deux variables
permettent de trancher si une installation en emploie d'autres :

```
MAR_ERP_SECTOR_LINK_CLIENT_COLUMN=id_b2b_client
MAR_ERP_SECTOR_LINK_SECTOR_COLUMN=id_interest
```

Un nom reconnu ne prouve rien : chaque reprise mesure la part des valeurs de
ces deux colonnes qui existe réellement dans la table visée, et la rapporte
(`id_interest → b2b_client_type 6/6`). Un rapport dégradé — `1/2`, `0/40` —
signale que la colonne désigne autre chose, avant que le vivier ne soit
démarché sur des secteurs faux.

Il n'y a rien à écrire tant que ces valeurs conviennent.

Les colonnes, elles, ne sont pas configurées : la reprise les découvre dans
`information_schema` et accepte plusieurs noms courants pour chaque notion
(`zip`, `cp` ou `postal_code` pour un code postal, par exemple). Le compte rendu
affiché à l'écran indique celles qu'elle a retenues — c'est le seul moyen de
vérifier, sans accès à la base, qu'elle a lu ce qu'on croit. Si une colonne
obligatoire manque, elle refuse en nommant ce qu'elle a trouvé à la place.

Quelques points à connaître :

- Une boutique inactive dans l'ERP est écartée : elle ne doit pas réapparaître
  dans le choix de périmètre d'une nouvelle campagne. Sur cette installation,
  `franchisee_shop` ne porte ni `code` ni indicateur d'activité : aucune
  boutique n'est donc écartée à ce titre.
- Seuls les clients professionnels rejoignent le vivier. Le marqueur retenu ici
  est `is_b2b`. La reprise ne teste pas « égal à 1 » mais « renseigné et non
  nul » : selon les installations la colonne porte un booléen ou un type de
  compte, et « = 1 » ne ramènerait alors qu'un type sur trois.
- Les secteurs visés sont les types de compte professionnel
  (`b2b_client_type`), rattachés aux clients par une table de liaison. Un compte
  peut relever de plusieurs secteurs. La colonne qui désigne le type y est
  cherchée d'abord dans les contraintes, puis dans la convention `id_<table>` ;
  faute des deux, la reprise refuse de rattacher quoi que ce soit et nomme les
  colonnes trouvées. Deux référentiels numérotés à partir de 1 se confondent
  sans erreur visible : mieux vaut un refus qu'un rattachement faux.
- Un compte du vivier sans aucun secteur ne sortira d'aucune génération de
  leads. Le compte rendu de reprise en donne le nombre.
- Aucune de ces tables n'est créée ni modifiée par le module : il les lit, un
  point c'est tout. Il n'existe volontairement aucun script qui les recrée —
  lancé par mégarde sur la base réelle, il effacerait l'ERP.

L'utilisateur MySQL du module doit avoir le droit de lecture sur le schéma de
l'ERP. Sans lui, la reprise s'arrête sur « table introuvable, ou aucun droit de
lecture dessus » — les deux cas se ressemblent vus du client MySQL.
