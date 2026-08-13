# SirDashboard — Guide d’installation (Ubuntu + Apache)

Documentation de déploiement en production : Flask derrière **Gunicorn**, exposé par **Apache** (reverse proxy), données utilisateurs dans **MariaDB**, métriques SOC via l’API **LogRhythm**.

Instance actuelle :

| Élément | Valeur |
|---------|--------|
| Serveur | `dashboard` — `172.20.200.64` |
| OS | Ubuntu (Python 3.14) |
| Application | `/opt/sirdashboard` |
| URL | http://172.20.200.64/ |
| Processus app | `www-data` (systemd `sirdashboard`) |
| SSH | `dash-user@172.20.200.64` — alias `ssh dashboard` |

---

## 1. Architecture

```
Navigateur
    │  HTTP :80  (optionnel HTTPS :443)
    ▼
Apache 2
    │  /static  → fichiers CSS/JS/images (disque)
    │  le reste → reverse proxy
    ▼
Gunicorn  127.0.0.1:8000
    ▼
Flask (wsgi:app)  +  MariaDB (airci)  +  API LogRhythm
```

**Pourquoi Apache + Gunicorn ?** Apache ne exécute pas Python. Gunicorn est le serveur WSGI. Apache termine HTTP, sert les fichiers statiques et relaie le reste vers Gunicorn (écoute locale uniquement, non exposé sur le réseau).

Fichiers concernés :

| Fichier | Rôle |
|---------|------|
| `wsgi.py` | Point d’entrée production : charge Flask et initialise la BDD / SuperAdmin |
| `gunicorn.conf.py` | Bind local, 3 workers, timeout 180 s (appels LogRhythm lents) |
| `deploy/sirdashboard.service` | Service systemd |
| `deploy/apache-sirdashboard.conf` | Virtual host Apache |
| `deploy/install.sh` | Installation automatique |
| `.env` | Secrets et configuration (jamais dans Git) |
| `.env.example` | Modèle sans secrets |

---

## 2. Prérequis

### Serveur

- Ubuntu **24.04 LTS** ou plus récent (Python **≥ 3.11** obligatoire : pandas 3)
- Accès root ou `sudo`
- Ports **22** (SSH), **80** (HTTP) ; **443** si HTTPS
- Le serveur doit joindre l’API LogRhythm (`LR_BASE_URL`, ex. `https://172.20.200.4:8501`)
- Ne pas copier le dossier `venv` Windows : il est incompatible avec Linux

### Paquets installés par le script

Apache, MariaDB, Python 3 (venv, pip, headers), outils de compilation, bibliothèques WeasyPrint (Pango, Cairo, GDK-Pixbuf, polices).

### Machine de développement (Windows)

- OpenSSH (`ssh`, `scp`)
- Clé SSH recommandée (voir § 8)

---

## 3. Fichier `.env`

Créer `/opt/sirdashboard/.env` à partir de `.env.example`. Le script d’install **écrase** `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` s’il génère un mot de passe MariaDB.

| Variable | Rôle |
|----------|------|
| `LR_BASE_URL` | URL de l’API LogRhythm (`https://host:8501`) |
| `LR_CLIENT_ID` | Client ID (base64) pour `/lr-auth-api/tokens` |
| `LR_CLIENT_SECRET` | Secret associé |
| `LR_FALLBACK_TOKEN` | JWT de secours si l’auth échoue |
| `FLASK_PORT` | Port Flask en mode `python app.py` (ignoré en production) |
| `CACHE_TTL` | Durée du cache métriques (secondes, défaut 300) |
| `LOCAL_DATA_FILE` | Optionnel : JSON local au lieu de l’API live |
| `SESSION_COOKIE_SECURE` | `true` uniquement si le site est en HTTPS |
| `SECRET_KEY` | Clé de signature des sessions Flask (chaîne longue aléatoire) |
| `DB_USER` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` / `DB_NAME` | MariaDB |
| `SUPERADMIN_USERNAME` | Email du premier compte (créé au boot si absent) |
| `SUPERADMIN_PASSWORD` | Mot de passe de ce compte (uniquement à la création) |
| `SUPERADMIN_ROLE` | `SuperAdmin` |

Permissions recommandées :

```bash
chown www-data:www-data /opt/sirdashboard/.env
chmod 640 /opt/sirdashboard/.env
```

---

## 4. Installation automatique (recommandée)

### 4.1 Déposer le code

**Depuis un ZIP (Windows → serveur)** — ne pas inclure `venv` :

```bash
cd /opt
unzip -q SirDashboard.zip -d /tmp/sirdashboard-src
mkdir -p /opt/sirdashboard
# Ajuster le chemin si le zip contient un dossier racine SirDashboard/
rsync -a --exclude 'venv' --exclude '.venv' --exclude '__pycache__' \
  /tmp/sirdashboard-src/SirDashboard/ /opt/sirdashboard/
# ou, si les fichiers sont déjà à la racine du zip :
# rsync -a --exclude 'venv' --exclude '.venv' /tmp/sirdashboard-src/ /opt/sirdashboard/
```

Le ZIP Windows crée souvent `/opt/sirdashboard/SirDashboard/`. Il faut **remonter** le contenu d’un niveau pour que `app.py` soit dans `/opt/sirdashboard/`.

Vérifier :

```bash
ls /opt/sirdashboard/app.py /opt/sirdashboard/deploy/install.sh /opt/sirdashboard/.env
```

**Fins de ligne Windows (CRLF)** — obligatoire avant d’exécuter le script, sinon :

```text
set: pipefail: invalid option name
```

```bash
cd /opt/sirdashboard
sed -i 's/\r$//' deploy/install.sh deploy/sirdashboard.service deploy/apache-sirdashboard.conf
```

### 4.2 Lancer l’install

En **root** :

```bash
cd /opt/sirdashboard
bash deploy/install.sh
```

Le script :

1. Installe les paquets système
2. Active `proxy`, `proxy_http`, `headers`, `rewrite`, `ssl`
3. Désactive le site Apache par défaut
4. Crée le venv Python et installe `requirements.txt` (dont Gunicorn)
5. Démarre MariaDB, crée la base `airci` et l’utilisateur `sirdashboard`
6. Écrit les identifiants BDD dans `.env` (mot de passe généré si `DB_PASSWORD` n’est pas passé en variable d’environnement)
7. Passe la propriété à `www-data`
8. Installe et démarre le service `sirdashboard`
9. Active le virtual host Apache

Variables optionnelles :

```bash
DB_NAME=airci DB_USER=sirdashboard DB_PASSWORD='MotDePasseFort' bash deploy/install.sh
```

### 4.3 Après le script

```bash
nano /etc/apache2/sites-available/sirdashboard.conf   # ServerName = IP ou FQDN
systemctl restart sirdashboard apache2
systemctl status sirdashboard --no-pager
curl -I http://127.0.0.1/
```

Une réponse **302** vers `/login` est normale (authentification Flask-Login).

Firewall :

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Ouvrir **http://IP-DU-SERVEUR/** et se connecter avec `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` du `.env`.

---

## 5. Installation manuelle

Utile si le script a été interrompu (paquet `dpkg` incomplet, etc.).

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
dpkg --configure -a
apt-get -f install -y
apt-get install -y apache2 mariadb-server python3 python3-venv python3-pip python3-dev \
  build-essential pkg-config rsync libmariadb-dev \
  libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
  libffi-dev libcairo2 shared-mime-info fonts-liberation

a2enmod proxy proxy_http headers rewrite ssl
a2dissite 000-default.conf

python3 -m venv /opt/sirdashboard/venv
/opt/sirdashboard/venv/bin/pip install --upgrade pip
/opt/sirdashboard/venv/bin/pip install -r /opt/sirdashboard/requirements.txt

systemctl enable --now mariadb
mysql -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS airci CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'sirdashboard'@'localhost' IDENTIFIED BY 'MOT_DE_PASSE';
GRANT ALL PRIVILEGES ON airci.* TO 'sirdashboard'@'localhost';
FLUSH PRIVILEGES;
SQL

chown -R www-data:www-data /opt/sirdashboard
chmod 640 /opt/sirdashboard/.env
chmod 750 /opt/sirdashboard

cp /opt/sirdashboard/deploy/sirdashboard.service /etc/systemd/system/
sed -i 's/\r$//' /etc/systemd/system/sirdashboard.service
systemctl daemon-reload
systemctl enable --now sirdashboard

cp /opt/sirdashboard/deploy/apache-sirdashboard.conf /etc/apache2/sites-available/sirdashboard.conf
sed -i 's/\r$//' /etc/apache2/sites-available/sirdashboard.conf
# Adapter ServerName
a2ensite sirdashboard.conf
apache2ctl configtest
systemctl reload apache2
```

---

## 6. Apache

Fichier : `/etc/apache2/sites-available/sirdashboard.conf`

- `Alias /static` : CSS/JS servis par Apache, pas par Flask
- `ProxyPass /static !` : ces URLs ne partent pas vers Gunicorn
- `ProxyPass / http://127.0.0.1:8000/` : le reste de l’application
- `X-Forwarded-Proto` : Flask (`ProxyFix`) sait s’il est derrière HTTP ou HTTPS

Avertissement fréquent, sans impact :

```text
Could not reliably determine the server's fully qualified domain name
```

Corriger :

```bash
echo 'ServerName 172.20.200.64' >> /etc/apache2/apache2.conf
systemctl reload apache2
```

Logs :

```bash
tail -f /var/log/apache2/sirdashboard-error.log
tail -f /var/log/apache2/sirdashboard-access.log
```

---

## 7. Gunicorn et systemd

Service : `sirdashboard.service`

- Utilisateur : `www-data`
- Répertoire : `/opt/sirdashboard`
- Commande : `venv/bin/gunicorn --config gunicorn.conf.py wsgi:app`
- Écoute : **127.0.0.1:8000** uniquement
- `timeout = 180` : les agrégations LogRhythm peuvent dépasser 30 s
- `init_db(app)` dans `wsgi.py` : crée les tables et le SuperAdmin au premier démarrage

Commandes :

```bash
systemctl status sirdashboard
systemctl restart sirdashboard
systemctl reload sirdashboard    # HUP = reload workers
journalctl -u sirdashboard -f
```

Au premier boot, plusieurs workers peuvent appeler `init_db` en parallèle ; un worker peut échouer une fois, systemd relance le service (`Restart=always`). Le SuperAdmin n’est créé que s’il n’existe pas déjà.

---

## 8. Accès SSH depuis Windows / Cursor

Sur le PC Windows, config `C:\Users\<vous>\.ssh\config` :

```
Host dashboard
    HostName 172.20.200.64
    User dash-user
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

Générer une clé et l’installer sur le serveur (une fois, avec mot de passe) :

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -N ""
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh dash-user@172.20.200.64 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Ensuite :

```powershell
ssh dashboard
```

`dash-user` est dans le groupe `sudo`. Les commandes d’administration :

```bash
sudo systemctl status sirdashboard
```

Depuis Cursor, une fois la clé en place, les mises à jour peuvent être poussées via cet hôte SSH.

---

## 9. HTTPS (optionnel)

```bash
apt install -y certbot python3-certbot-apache
certbot --apache -d votre-domaine.ci
```

Dans `/opt/sirdashboard/.env` :

```env
SESSION_COOKIE_SECURE=true
```

Dans le vhost, `X-Forwarded-Proto` doit valoir `https`. Puis :

```bash
systemctl restart sirdashboard apache2
```

Sans nom de domaine public, rester en HTTP interne ou installer un certificat interne.

---

## 10. Mise à jour de l’application

Depuis le PC (exemple) :

```powershell
scp -r C:\laragon\www\SirDashboard\app.py dashboard:/tmp/app.py
ssh dashboard "sudo cp /tmp/app.py /opt/sirdashboard/app.py && sudo chown www-data:www-data /opt/sirdashboard/app.py && sudo systemctl restart sirdashboard"
```

Sur le serveur, après copie du nouveau code (sans écraser `.env` ni `venv`) :

```bash
cd /opt/sirdashboard
sudo -u www-data /opt/sirdashboard/venv/bin/pip install -r requirements.txt
sudo systemctl restart sirdashboard
```

Ne pas relancer `install.sh` à chaque mise à jour : il régénère un mot de passe MariaDB si `DB_PASSWORD` n’est pas fourni.

---

## 11. Développement local (Laragon / Windows)

```bash
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
# renseigner MariaDB local + LogRhythm
python app.py
```

Ouvrir http://localhost:5000 — **ne pas utiliser** Gunicorn/Apache en local.

---

## 12. Dépannage

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| `set: pipefail: invalid option name` | Fins de ligne CRLF | `sed -i 's/\r$//' deploy/install.sh` |
| `Python 3.11+ est requis` | Ubuntu 22.04 / Python 3.10 | Ubuntu 24.04+ |
| Service `failed` / Worker failed to boot | BDD inaccessible, `.env` illisible, import Python | `journalctl -u sirdashboard -n 80` |
| `Access denied` MariaDB | Mauvais `DB_*` dans `.env` | Relire `.env`, tester `mysql -u sirdashboard -p airci` |
| Page blanche / 502 | Gunicorn arrêté | `systemctl restart sirdashboard` |
| CSS/JS cassés | Alias `/static` ou droits | `ls -la /opt/sirdashboard/static` ; Apache doit pouvoir lire |
| Login OK mais session perdue | HTTPS sans `SESSION_COOKIE_SECURE` cohérent, ou `SECRET_KEY` changée | Aligner `.env` et redémarrer |
| Timeout dashboard | API LogRhythm lente | Vérifier `LR_BASE_URL` depuis le serveur ; timeout Gunicorn = 180 s |
| SSL LogRhythm | Certificat auto-signé | L’app utilise `verify=False` (comportement actuel) |
| ZIP trop gros (~80 Mo) | `venv` Windows inclus | Ré-extraire avec `--exclude venv` |

Vérifications rapides :

```bash
systemctl is-active sirdashboard apache2 mariadb
ss -lntp | grep -E ':80|:8000|:3306'
curl -sI http://127.0.0.1:8000/
curl -sI http://127.0.0.1/
```

Si `apt` a été tué en cours d’install :

```bash
dpkg --configure -a
apt-get -f install -y
bash /opt/sirdashboard/deploy/install.sh
```

---

## 13. Sécurité minimale

- Gunicorn n’écoute pas sur `0.0.0.0` : seul Apache est public
- `.env` en `640`, propriétaire `www-data`
- Compte MariaDB dédié (`sirdashboard`), pas `root` sans mot de passe
- Changer le mot de passe SSH et SuperAdmin après le premier déploiement
- Ne pas committer `.env` (déjà dans `.gitignore`)
- Préférer une clé SSH au mot de passe
- Activer HTTPS dès que le dashboard est joignable hors réseau interne

---

## 14. Récapitulatif instance `172.20.200.64`

Déploiement effectué le **13 août 2026** :

1. Archive `SirDashboard.zip` déposée dans `/opt`
2. Extraction vers `/opt/sirdashboard` (dossier imbriqué corrigé)
3. Conversion CRLF des scripts `deploy/`
4. `bash deploy/install.sh` (Apache, MariaDB, venv, Gunicorn, vhost)
5. `ServerName 172.20.200.64`
6. Services **active** : `sirdashboard`, `apache2`, `mariadb`
7. SuperAdmin créé depuis le `.env`
8. Accès HTTP : redirection 302 → `/login`

Connexion opérateur :

```powershell
ssh dashboard
```

Application :

```text
http://172.20.200.64/
```
