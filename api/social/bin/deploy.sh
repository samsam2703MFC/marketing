#!/usr/bin/env bash
#
# Déploiement de l'API Social du Marketing (api/social du dépôt marketing) sur le serveur.
# À exécuter EN ROOT SUR LE SERVEUR, depuis une copie de api/social :
#
#   sudo bin/deploy.sh
#
# Le code est installé dans son dossier (/var/www/social : les visuels déposés y restent) et
# servi sous /marketing/social. Plus aucun écran ici : ils sont dans le Marketing. Les anciennes
# adresses (/social, /marketing/franchise, /social_franchisee) restent servies — Meta y envoie
# ses notifications, les QR codes imprimés et les liens de l'ERP y mènent — et renvoient les
# écrans au Marketing. Aucun secret : la base vient du config du BO, tout le reste est en base
# (tables mar_sa_*, réglages dans mar_variable, secrets chiffrés dans mar_keys).
set -euo pipefail

TARGET_DIR="${TARGET_DIR:-/var/www/social}"            # dépôt complet, hors webroot
ALIAS_PATH="${ALIAS_PATH:-/social}"                    # URL servie par Apache
BO_DIR="${BO_DIR:-/var/www/consulant_bo}"              # installation du BO consultant
BO_URL="${BO_URL:-/consulant_bo/}"
PUBLIC_URL="${PUBLIC_URL:-https://185.180.206.46${ALIAS_PATH}/}"
LOCAL_BASE="http://127.0.0.1${ALIAS_PATH}"
# Ancien espace franchisé : ses adresses renvoient aux pages du Marketing (espace/.htaccess).
FR_ALIAS="${FR_ALIAS:-/social_franchisee}"
OLD_FR_DIR="/var/www/social_franchisee"
MKT_ALIAS="${MKT_ALIAS:-/marketing/social}"
MKT_FR_ALIAS="${MKT_FR_ALIAS:-/marketing/franchise}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf '\033[1;34m[social]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[social]\033[0m %s\n' "$*"; }

# --- 1. Prérequis : ceux du BO (Apache, PHP, pdo_mysql, curl) ----------------
command -v php >/dev/null || { warn "php absent — installez d'abord le BO consultant."; exit 1; }
# La liste des modules est lue une fois : `php -m | grep -q` échoue sous pipefail
# (grep s'arrête au premier résultat, php reçoit SIGPIPE) — faux « absent ».
PHP_MODS="$(php -m 2>/dev/null)"
grep -qi '^pdo_mysql$' <<<"$PHP_MODS" || { warn "pdo_mysql absent."; exit 1; }
grep -qi '^curl$' <<<"$PHP_MODS" || { warn "php-curl absent (appels Meta) — installation…"; apt-get -o DPkg::Lock::Timeout=600 install -y -qq php-curl >/dev/null; }
a2enmod rewrite >/dev/null 2>&1 || true
a2enmod headers >/dev/null 2>&1 || true
[[ -f "$BO_DIR/config/config.php" ]] || warn "Config du BO introuvable ($BO_DIR/config/config.php) : l'API répondra 503 tant qu'il manque."

# --- 2. Syntaxe : refuser de livrer du code qui ne se charge pas --------------
for f in "$REPO_SRC"/src/*.php "$REPO_SRC"/public/api/*.php "$REPO_SRC"/bin/*.php; do
  php -l "$f" >/dev/null || { warn "SYNTAXE PHP : $f"; exit 1; }
done

# --- 3. Fichiers -----------------------------------------------------------------
log "Copie vers $TARGET_DIR (les visuels déposés, public/uploads, sont conservés)…"
mkdir -p "$TARGET_DIR"
rsync -a --delete --exclude '.git' --exclude 'config/config.php' --exclude 'config/hote.php' --exclude 'public/uploads' --exclude '.deployenv' \
  "$REPO_SRC/" "$TARGET_DIR/"
mkdir -p "$TARGET_DIR/public/uploads"
chown -R www-data:www-data "$TARGET_DIR/public/uploads"
chmod -R u+rwX,g+rX "$TARGET_DIR/public/uploads"

# Les pages de l'ancien espace franchisé ne sont plus servies (renvois seulement).
[[ -d "$OLD_FR_DIR" ]] && { log "Ancien espace franchisé retiré ($OLD_FR_DIR)"; rm -rf "$OLD_FR_DIR"; }

# --- 4. config/config.php : où trouver le BO (aucun secret) ------------------------
CFG="$TARGET_DIR/config/config.php"
BO_DIR="$BO_DIR" BO_URL="$BO_URL" PUBLIC_URL="$PUBLIC_URL" php -r '
  $cfg = ["boDir" => getenv("BO_DIR"), "boUrl" => getenv("BO_URL"), "publicUrl" => getenv("PUBLIC_URL"),
          "db" => null, "auth" => null, "userName" => "Franchiseur"];
  echo "<?php\n// Écrit par bin/deploy.sh — les données et les clés sont en base (mar_variable / mar_keys).\nreturn " . var_export($cfg, true) . ";\n";
' > "$CFG"
chmod 640 "$CFG"; chown www-data:www-data "$CFG"

# --- 5. Apache : alias /social (et /marketing/social) -------------------------------
log "Apache : alias $MKT_ALIAS et $ALIAS_PATH → $TARGET_DIR/public ; $MKT_FR_ALIAS et $FR_ALIAS → renvois"
cat > /etc/apache2/conf-available/social.conf <<APACHE
# API Social du Marketing. Sous /marketing, avant le dossier de son application : ces chemins-là sont à l'API.
Alias ${MKT_ALIAS} ${TARGET_DIR}/public
Alias ${ALIAS_PATH} ${TARGET_DIR}/public
<Directory ${TARGET_DIR}/public>
    AllowOverride All
    Require all granted
</Directory>
# Ancien espace franchisé : renvois vers les pages du Marketing.
Alias ${MKT_FR_ALIAS} ${TARGET_DIR}/espace
Alias ${FR_ALIAS} ${TARGET_DIR}/espace
<Directory ${TARGET_DIR}/espace>
    AllowOverride All
    Require all granted
</Directory>
APACHE
a2enconf social >/dev/null
apache2ctl configtest
systemctl reload apache2 || systemctl restart apache2

# --- 6. Installation des tables mar_sa_* (premier appel) ---------------------------
log "Installation des tables mar_sa_* et des paramètres…"
runuser -u www-data -- php -r 'require "'"$TARGET_DIR"'/src/api.php"; socInstall(); echo "tables OK\n";' || warn "Installation des tables en échec (base injoignable ?)"

# --- 7. Cron : file de publication, synchro Meta, contrôle des connexions ----------
cat > /etc/cron.d/social <<CRON
# Module Social & Ads — posé par bin/deploy.sh
SHELL=/bin/bash
* * * * *   www-data php ${TARGET_DIR}/bin/cron.php queue >> /var/log/social-cron.log 2>&1
0-59/5 * * * * www-data php ${TARGET_DIR}/bin/cron.php repost >> /var/log/social-cron.log 2>&1
7 * * * *   www-data php ${TARGET_DIR}/bin/cron.php sync  >> /var/log/social-cron.log 2>&1
40 6 * * *  www-data php ${TARGET_DIR}/bin/cron.php conn  >> /var/log/social-cron.log 2>&1
37 * * * *  www-data php ${TARGET_DIR}/bin/cron.php ids   >> /var/log/social-cron.log 2>&1
20 5 * * *  www-data php ${TARGET_DIR}/bin/cron.php audit >> /var/log/social-cron.log 2>&1
CRON
chmod 644 /etc/cron.d/social
touch /var/log/social-cron.log; chown www-data:www-data /var/log/social-cron.log

# --- 8. Recette locale ---------------------------------------------------------------
fail=0
st=$(curl -fsS --max-time 20 "$LOCAL_BASE/api/v1/social/status" || echo '{}')
echo "status : $st"
grep -q '"db":true' <<<"$st" && log "OK  base joignable (identifiants du BO)" || { warn "base injoignable"; fail=1; }
st2=$(curl -fsS --max-time 20 "http://127.0.0.1${MKT_ALIAS}/api/v1/social/status" || echo '{}')
grep -q '"db":true' <<<"$st2" && log "OK  API sous ${MKT_ALIAS}" || { warn "API sous ${MKT_ALIAS} injoignable"; fail=1; }
# Les anciennes adresses renvoient au Marketing.
loc() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$1"; }
r=$(loc "http://127.0.0.1${MKT_ALIAS}/SA%20Calendrier.dc.html?op=3")
[[ "$r" == 302*"/marketing/?ecran=social-cal&op=3" ]] && log "OK  ancien écran → Marketing" || { warn "SA Calendrier → $r"; fail=1; }
r=$(loc "http://127.0.0.1${MKT_ALIAS}/SA%20Parametres.dc.html?tab=api&section=dsa")
[[ "$r" == 302*"ecran=social-set-dsa" ]] && log "OK  Paramètres → onglet" || { warn "SA Parametres → $r"; fail=1; }
r=$(loc "http://127.0.0.1${FR_ALIAS}/publier?shop=4")
[[ "$r" == 302*"ecran=sf-pub&shop=4" ]] && log "OK  ancien espace franchisé → Marketing" || { warn "${FR_ALIAS}/publier → $r"; fail=1; }
r=$(loc "http://127.0.0.1${MKT_FR_ALIAS}/calendrier")
[[ "$r" == 302*"ecran=sf-cal" ]] && log "OK  ${MKT_FR_ALIAS} → Marketing" || { warn "${MKT_FR_ALIAS}/calendrier → $r"; fail=1; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$LOCAL_BASE/uploads/__absent__.png")
[[ "$code" == "404" ]] && log "OK  un visuel absent rend 404" || warn "uploads absent → HTTP $code (404 attendu)"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1${MKT_ALIAS}/Affiche%20avis.html")
[[ "$code" == "200" ]] && log "OK  affiche avis servie" || { warn "Affiche avis → HTTP $code"; fail=1; }
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$LOCAL_BASE/api/v1/social/franchise/etat")
[[ "$code" == "401" || "$code" == "200" ]] && log "OK  API de l'espace franchisé (sans session ERP : HTTP $code)" || { warn "franchise/etat sans session → HTTP $code (401 ou 200 attendu)"; fail=1; }
[[ "$fail" == "0" ]] && log "API Social en ligne : http://185.180.206.46${MKT_ALIAS}/api/v1/social/status" || { warn "Recette en échec."; exit 1; }
