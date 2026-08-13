#!/usr/bin/env bash
# Installation SirDashboard sur Ubuntu 22.04 / 24.04 + Apache + MariaDB + Gunicorn
# Usage (en root, depuis le dossier du projet déjà copié) :
#   sudo bash deploy/install.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sirdashboard}"
APP_USER="www-data"
DB_NAME="${DB_NAME:-airci}"
DB_USER="${DB_USER:-sirdashboard}"
DB_PASSWORD="${DB_PASSWORD:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Lancer ce script en root : sudo bash deploy/install.sh"
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installation des paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  apache2 \
  mariadb-server \
  python3 \
  python3-venv \
  python3-pip \
  python3-dev \
  build-essential \
  pkg-config \
  rsync \
  libmariadb-dev \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libgdk-pixbuf-2.0-0 \
  libffi-dev \
  shared-mime-info \
  libcairo2 \
  fonts-liberation

PY_MAJOR="$("$(command -v python3)" -c 'import sys; print(sys.version_info.major)')"
PY_MINOR="$("$(command -v python3)" -c 'import sys; print(sys.version_info.minor)')"
if [[ "${PY_MAJOR}" -lt 3 || "${PY_MINOR}" -lt 11 ]]; then
  echo "Python 3.11+ est requis (pandas 3). Ubuntu 24.04 LTS recommandé (Python 3.12)."
  echo "Version détectée : $(python3 --version)"
  exit 1
fi

echo "==> Activation des modules Apache"
a2enmod proxy proxy_http headers rewrite ssl
a2dissite 000-default.conf >/dev/null 2>&1 || true

if [[ "${SOURCE_DIR}" != "${APP_DIR}" ]]; then
  echo "==> Copie de l'application vers ${APP_DIR}"
  mkdir -p "${APP_DIR}"
  rsync -a --delete \
    --exclude 'venv' \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '.git' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
else
  echo "==> Application déjà dans ${APP_DIR}, copie ignorée"
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
  if [[ -f "${APP_DIR}/.env.example" ]]; then
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
    echo "Fichier .env créé depuis .env.example — à compléter avant le premier démarrage."
  else
    echo "ERREUR : aucun .env trouvé. Copiez .env.example vers ${APP_DIR}/.env"
    exit 1
  fi
fi

echo "==> Environnement Python"
python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --upgrade pip
"${APP_DIR}/venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

echo "==> MariaDB"
systemctl enable --now mariadb

if [[ -z "${DB_PASSWORD}" ]]; then
  DB_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
  echo "Mot de passe MariaDB généré (stocké dans ${APP_DIR}/.env)."
fi

mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# Met à jour les identifiants BDD dans .env sans écraser le reste
python3 - <<PY
from pathlib import Path
p = Path("${APP_DIR}/.env")
text = p.read_text(encoding="utf-8")
replacements = {
    "DB_USER": "${DB_USER}",
    "DB_PASSWORD": "${DB_PASSWORD}",
    "DB_HOST": "localhost",
    "DB_PORT": "3306",
    "DB_NAME": "${DB_NAME}",
}
lines = []
seen = set()
for line in text.splitlines():
    key = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else None
    if key in replacements:
        lines.append(f"{key}={replacements[key]}")
        seen.add(key)
    else:
        lines.append(line)
for key, val in replacements.items():
    if key not in seen:
        lines.append(f"{key}={val}")
p.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

echo "==> Droits fichiers"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 640 "${APP_DIR}/.env"
chmod 750 "${APP_DIR}"

echo "==> Service systemd Gunicorn"
cp "${APP_DIR}/deploy/sirdashboard.service" /etc/systemd/system/sirdashboard.service
sed -i 's/\r$//' /etc/systemd/system/sirdashboard.service
systemctl daemon-reload
systemctl enable --now sirdashboard

echo "==> VirtualHost Apache"
cp "${APP_DIR}/deploy/apache-sirdashboard.conf" /etc/apache2/sites-available/sirdashboard.conf
sed -i 's/\r$//' /etc/apache2/sites-available/sirdashboard.conf
a2ensite sirdashboard.conf
apache2ctl configtest
systemctl reload apache2

echo
echo "Installation terminée."
echo "  Application : ${APP_DIR}"
echo "  Gunicorn    : 127.0.0.1:8000 (systemd: sirdashboard)"
echo "  Apache      : http://<IP-du-serveur>/"
echo
echo "À faire :"
echo "  1. Éditer ${APP_DIR}/.env (LogRhythm, SECRET_KEY, SuperAdmin)"
echo "  2. Adapter ServerName dans /etc/apache2/sites-available/sirdashboard.conf"
echo "  3. sudo systemctl restart sirdashboard apache2"
echo "  4. Vérifier : sudo systemctl status sirdashboard"
echo "  5. Ouvrir le port 80 (et 443) dans le firewall si besoin"
