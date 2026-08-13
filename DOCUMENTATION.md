# SirDashboard — Documentation Technique

> Dashboard SOC pour LogRhythm SIEM — Flask + Vanilla JS

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture](#2-architecture)
3. [Configuration `.env`](#3-configuration-env)
4. [Backend Python](#4-backend-python)
   - [app.py — Routes Flask](#41-apppy--routes-flask)
   - [logrhythm/constants.py — Données de référence](#42-logrhythmconstantspy--données-de-référence)
   - [logrhythm/classify.py — Classification](#43-logrhythmclassifypy--classification)
   - [logrhythm/auth.py — Authentification](#44-logrhythmauthpy--authentification)
   - [logrhythm/client.py — Appels API](#45-logrhythmclientpy--appels-api)
   - [logrhythm/metrics.py — Calcul des métriques](#46-logrhythmmetricspy--calcul-des-métriques)
5. [Frontend JavaScript](#5-frontend-javascript)
   - [config.js — Couleurs et palettes](#51-configjs--couleurs-et-palettes)
   - [helpers.js — Utilitaires](#52-helpersjs--utilitaires)
   - [period.js — Sélecteur de période (partagé)](#53-periodjs--sélecteur-de-période-partagé)
   - [main.js — Page Dashboard](#54-mainjs--page-dashboard)
   - [events.js — Page Events](#55-eventsjs--page-events)
   - [modal.js — Modal détail alarme](#56-modaljs--modal-détail-alarme)
   - [charts.js — Graphiques Chart.js](#57-chartsjs--graphiques-chartjs)
6. [Templates HTML / CSS](#6-templates-html--css)
7. [Flux de données complet](#7-flux-de-données-complet)
8. [API Flask — Référence des endpoints](#8-api-flask--référence-des-endpoints)
9. [Mode local (fichier JSON)](#9-mode-local-fichier-json)
10. [Guide — Ajouter ou modifier une feature](#10-guide--ajouter-ou-modifier-une-feature)

---

## 1. Vue d'ensemble

SirDashboard est un tableau de bord SOC (Security Operations Center) qui se connecte à une instance LogRhythm SIEM via son API REST pour afficher :

- **KPIs** : total alarmes, critical/high/medium/low, intrusions, backlog, faux positifs
- **Graphiques** : évolution temporelle, répartition par entité, top règles AIE, top classifications
- **Page Events** : liste complète et filtrable des alarmes avec pagination et recherche
- **Modal drilldown** : détail d'une alarme + hosts/IPs/utilisateurs impliqués (via `/lr-alarm-api/alarms/{id}/events`)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Navigateur                          │
│                                                         │
│  /          → index.html  (Dashboard)                   │
│  /events    → events.html (Liste alarmes)               │
│                                                         │
│  JS communs : config.js, helpers.js, period.js,         │
│               modal.js                                  │
│  JS pages   : main.js (dashboard) | events.js (events)  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP (JSON)
┌────────────────────────▼────────────────────────────────┐
│                   Flask — app.py                        │
│                                                         │
│  GET /api/metrics     → métriques dashboard             │
│  GET /api/alarms      → liste alarmes filtrée           │
│  GET /api/drilldown/{id} → events d'une alarme          │
│                                                         │
│  Cache en mémoire (TTL = CACHE_TTL secondes)            │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│               Package logrhythm/                        │
│                                                         │
│  auth.py    → token Bearer (cache auto)                 │
│  client.py  → GET /lr-alarm-api/alarms (paginé)         │
│               GET /lr-alarm-api/alarms/{id}/events      │
│               GET /lr-case-api/cases                    │
│  classify.py → classification + risk rating             │
│  metrics.py  → agrégation de toutes les métriques       │
│  constants.py → référentiel statique                    │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS (verify=False)
┌────────────────────────▼────────────────────────────────┐
│          LogRhythm SIEM API (LR_BASE_URL)               │
│          ex: https://172.20.200.4:8501                  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Configuration `.env`

| Variable           | Rôle                                                              |
|--------------------|-------------------------------------------------------------------|
| `LR_BASE_URL`      | URL base de l'API LogRhythm (`https://host:8501`)                 |
| `LR_CLIENT_ID`     | Client ID en base64 pour l'auth (`/lr-auth-api/tokens`)           |
| `LR_CLIENT_SECRET` | Secret associé                                                    |
| `LR_FALLBACK_TOKEN`| Token JWT statique utilisé si l'auth échoue                       |
| `FLASK_PORT`       | Port Flask (défaut : `5000`)                                      |
| `CACHE_TTL`        | Durée du cache en secondes (défaut : `300` = 5 min)               |
| `LOCAL_DATA_FILE`  | **Optionnel** : nom d'un fichier JSON dans `data/` pour le mode local. Commenter pour utiliser l'API live. |

**Mode live** : `LOCAL_DATA_FILE` commenté → appels directs à LogRhythm.
**Mode local** : `LOCAL_DATA_FILE=alarms_export_xxx.json` → lit le fichier, aucun appel réseau.

---

## 4. Backend Python

### 4.1 `app.py` — Routes Flask

Point d'entrée du serveur. Gère le **cache en mémoire** et expose les endpoints.

**Cache** :
```python
_cache: dict = {}   # { (date_from, date_to): {"data": ..., "ts": timestamp} }
```
- Clé = `(date_from, date_to)` au format `YYYY-MM-DDT00:00:00Z` / `YYYY-MM-DDT23:59:59Z`
- TTL défini par `CACHE_TTL` (env). Le paramètre `?force=true` invalide le cache.
- `_range_from_days(days)` génère la plage à partir d'un nombre de jours (tronqué au jour, pas à la seconde → même clé toute la journée).

**Mode local** :
```python
if _LOCAL_FILE:
    _local_metrics, _local_drilldown = logrhythm.compute_metrics_from_file(_fp)
```
Si chargé, `_compute()` retourne toujours `_local_metrics` sans toucher au cache ni à l'API.

---

### 4.2 `logrhythm/constants.py` — Données de référence

**À modifier pour personnaliser le comportement du dashboard.**

| Constante                  | Rôle                                                                 |
|----------------------------|----------------------------------------------------------------------|
| `ALARM_STATUS`             | Mapping entier → label (`0: "New"`, `1: "Open"`, …)                 |
| `BACKLOG_STATUSES`         | Statuts considérés "non traités" (`{0,1,2,3}`)                      |
| `FALSE_POS_STATUSES`       | Statuts faux positifs (`{4}`)                                        |
| `TRUE_POS_STATUSES`        | Statuts vrais positifs (`{5,7}`)                                     |
| `LR_CLASSIFICATIONS`       | `{"Classification": risk_rating}` — 14 types standard + custom      |
| `RR_CRITICAL` / `RR_HIGH`  | Seuils RR pour les niveaux de sévérité (`9` et `8`)                 |
| `INTRUSION_CLASSIFICATIONS`| Set des classifications comptant comme "Tentative d'intrusion"       |
| `CLASSIFICATION_KEYWORDS`  | Mots-clés fallback si le champ `classification` est absent de l'API  |

**Modifier `INTRUSION_CLASSIFICATIONS`** pour changer quelles alarmes comptent dans le KPI Intrusion.

> ⚠️ Les valeurs dans `INTRUSION_CLASSIFICATIONS` doivent correspondre **exactement** aux chaînes retournées par `classify_alarm()` — soit les valeurs natives de l'API, soit les clés de `LR_CLASSIFICATIONS`.

---

### 4.3 `logrhythm/classify.py` — Classification

```python
def classify_alarm(alarm: dict) -> tuple[str, int]:
    # 1. Champ natif LogRhythm (alarm["classification"])
    #    → toujours prioritaire, RR = LR_CLASSIFICATIONS.get(native, 0)
    # 2. Fallback : mots-clés dans alarm["alarmRuleName"]
    # 3. Dernier recours : "Other Security", RR=0
```

```python
def get_severity(rr: int) -> str | None:
    # "critical" si RR >= 9, "high" si RR >= 8, None sinon
    # Utilisé uniquement pour la table critique (backlog)
```

**Ajouter une classification** : ajouter la clé dans `LR_CLASSIFICATIONS` avec son RR, et éventuellement dans `INTRUSION_CLASSIFICATIONS`.

---

### 4.4 `logrhythm/auth.py` — Authentification

- Appelle `POST /lr-auth-api/tokens` avec `clientId` + `clientSecret`
- Cache le token JWT en mémoire avec expiration automatique (lu depuis le payload base64)
- Si l'auth échoue → utilise `LR_FALLBACK_TOKEN`
- `verify=False` : certificat SSL auto-signé LogRhythm ignoré (urllib3 warnings supprimés)
- Expose `_get(path, params)` : GET authentifié, retourne JSON ou `None`

---

### 4.5 `logrhythm/client.py` — Appels API

**`fetch_alarms(date_from, date_to, limit=None)`**
- Pagination automatique par blocs de 500 (`_BATCH`)
- Tri `DateInserted` descending
- Filtre Python double-borne : `date_from <= dateInserted <= date_to`
- Arrêt anticipé : dès que la plus ancienne alarme d'une page est < `date_from`

**`fetch_drilldown(alarm_id)`**
- Appelle `GET /lr-alarm-api/alarms/{id}/events`
- Extrait et déduplique : sourceHosts, destHosts, sourceIps, destIps, users (5 max chacun)

**`fetch_cases(date_from, date_to, count=500)`**
- Appelle `GET /lr-case-api/cases` avec `createdAfter`/`createdBefore`

---

### 4.6 `logrhythm/metrics.py` — Calcul des métriques

`_compute_from_alarms(alarms, date_from, date_to, cases)` — fonction centrale :

Pour chaque alarme :
1. Appelle `classify_alarm(alarm)` → `(classification, rr)`
2. Calcule `sev_label` : `"critical"` (rr≥9) / `"high"` (rr≥8) / `"medium"` (rr≥5) / `"low"`
3. `is_intrusion = classification in INTRUSION_CLASSIFICATIONS`
4. Alimente tous les compteurs : status, entité, règle, classification, daily
5. Construit `alarm_list` (toutes alarmes) et `critical_list` (backlog RR≥8, max 20)

**Métriques retournées** :

| Clé                    | Contenu                                             |
|------------------------|-----------------------------------------------------|
| `total_alarms`         | Nombre total d'alarmes dans la période              |
| `critical_alarms`      | Alarmes RR≥9 **ET** status backlog                  |
| `high_alarms`          | Alarmes RR≥8 **ET** status backlog                  |
| `severity_critical/high/medium/low` | Comptage **toutes alarmes** par sévérité |
| `intrusion_attempts`   | Alarmes dont classification ∈ `INTRUSION_CLASSIFICATIONS` |
| `backlog`              | Alarmes status ∈ `{0,1,2,3}`                        |
| `false_positive_rate`  | % alarmes status 4                                  |
| `true_positive_rate`   | % alarmes status 5 ou 7                             |
| `daily_labels`         | Liste de dates `YYYY-MM-DD` triées                  |
| `daily_counts`         | Nb alarmes par jour                                 |
| `daily_by_severity`    | `{Critical/High/Medium/Low: [nb par jour]}`         |
| `by_status`            | `{label_statut: count}`                             |
| `top_entities`         | Top 10 entités par nb d'alarmes                     |
| `top_rules`            | Top 10 règles AIE                                   |
| `classifications`      | Toutes les classifications avec leur count          |
| `critical_list`        | 20 premières alarmes backlog RR≥8 (pour la table)   |
| `alarm_list`           | Toutes les alarmes (pour `/api/alarms` + page Events)|

---

## 5. Frontend JavaScript

Chargement dans `base.html` (ordre requis) :
```
config.js → helpers.js → period.js → modal.js → [main.js ou events.js]
```

### 5.1 `config.js` — Couleurs et palettes

- Configuration globale Chart.js (font, grille, tooltips, légendes)
- `CLASSIF_COLORS` : `{classification: "#hexcolor"}` — couleur de chaque classification dans les graphiques
- `RR_META` : `{rr: {level, meaning, action, desc, cls, icon}}` — métadonnées par Risk Rating (affiché dans la modal)

**Modifier les couleurs des classifications** : éditer `CLASSIF_COLORS`.
**Modifier les textes de la modal** : éditer `RR_META`.

---

### 5.2 `helpers.js` — Utilitaires

Fonctions pures réutilisables dans toutes les pages :

| Fonction                        | Rôle                                               |
|---------------------------------|----------------------------------------------------|
| `fmtNum(n)`                     | Formate un nombre avec séparateur (`1 234`)        |
| `escHtml(s)`                    | Échappe le HTML (sécurité XSS)                     |
| `classificationBadge(c, rr)`   | Génère un `<span class="badge ...">` coloré        |
| `statusBadge(status)`           | Badge pour le statut d'alarme                      |
| `showLoader(visible)`           | Affiche/masque le loader de la page                |

---

### 5.3 `period.js` — Sélecteur de période (partagé)

Module partagé entre Dashboard et Events. Gère :
- Les boutons **7j / 14j / 30j / 90j**
- Le date picker **Flatpickr** (plage custom)
- L'auto-refresh toutes les 5 minutes
- Le timer du footer

**Variables globales exposées** :
```javascript
currentDays      // nombre de jours sélectionné (défaut: 30)
customDateFrom   // date début custom (format YYYY-MM-DD) ou null
customDateTo     // date fin custom ou null
```

**Fonctions exposées** :
```javascript
buildApiUrl(base, force)   // construit l'URL avec ?days= ou ?date_from=&date_to= et ?force=true
applyCustomRange()         // déclenché par le bouton "✓"
clearCustomRange()         // efface la plage custom
spinRefresh(ms)            // anime l'icône refresh pendant ms millisecondes
isoDate(d)                 // Date → "YYYY-MM-DD"
```

**Callback requis** : chaque page doit définir `_loadPageData(days, dateFrom, dateTo)` avant que `period.js` s'exécute. `period.js` appelle cette fonction au chargement et à chaque changement de période.

---

### 5.4 `main.js` — Page Dashboard

Définit `_loadPageData()` → appelle `GET /api/metrics?days=N` (ou `?date_from=&date_to=`).

**Fonctions principales** :

| Fonction              | Rôle                                                      |
|-----------------------|-----------------------------------------------------------|
| `renderAll(data)`     | Dispatch vers toutes les fonctions de rendu               |
| `renderKPIs(data)`    | Met à jour les 6 KPI cards                                |
| `renderCharts(data)`  | Crée/met à jour les graphiques Chart.js                   |
| `renderCriticalTable(data)` | Remplit la table des alarmes critiques (backlog)   |
| `openAlarmsPage(sev)` | Ouvre `/events?severity=X&days=N` dans un nouvel onglet   |
| `refreshData()`       | Force reload avec `?force=true`                           |

**Variable globale** : `_criticalAlarms` — tableau des alarmes affichées dans la table critique (utilisé par `modal.js`).

---

### 5.5 `events.js` — Page Events

Définit `_loadPageData()` → appelle `GET /api/alarms`.

**Variables d'état** :
```javascript
_allAlarms        // toutes les alarmes de la période (brutes)
_filtered         // alarmes après filtre sévérité + recherche texte
_criticalAlarms   // alias de _filtered (pour modal.js)
_currentSeverity  // "all"|"critical"|"high"|"medium"|"low"|"intrusion"
_searchText       // texte de recherche
_currentPage      // page courante (pagination)
PAGE_SIZE = 50    // alarmes par page
```

**Flux** :
```
loadEvents(force)
  → fetch /api/alarms
  → _allAlarms = data.alarms
  → updateCounts()   (met à jour les badges des onglets)
  → applyFilters()
      → _filtered = filtre par sévérité + recherche
      → _criticalAlarms = _filtered
      → renderPage()
          → affiche les lignes PAGE_SIZE × page
          → met à jour la pagination
```

---

### 5.6 `modal.js` — Modal détail alarme

Partagé par les deux pages. Utilise `_criticalAlarms[idx]` (défini par `main.js` ou `events.js`).

**`showAlarmDetail(idx)`** :
1. Lit `_criticalAlarms[idx]`
2. Remplit tous les champs de la modal (ID, date, classification, RR, entité, host, statut, sévérité)
3. Lance `fetch('/api/drilldown/{alarmId}')` en lazy → affiche hosts/IPs/users dans les chips

**`closeAlarmDetail()`** : ferme la modal (aussi déclenché par Échap ou clic sur l'overlay).

---

### 5.7 `charts.js` — Graphiques Chart.js

Crée et met à jour les graphiques. Chaque graphique est stocké dans une variable pour être détruit/recréé à chaque refresh.

| Variable      | Type    | Données                              |
|---------------|---------|--------------------------------------|
| `_chartDaily` | Line    | Évolution quotidienne par sévérité   |
| `_chartEntity`| Bar     | Top 5 entités dans le temps          |
| `_chartRule`  | Doughnut| Top 10 règles AIE                    |
| `_chartClassif`| Bar    | Répartition des classifications      |

---

## 6. Templates HTML / CSS

### Héritage Jinja2

```
base.html
├── index.html   (active_tab="dashboard")
└── events.html  (active_tab="events")
```

`base.html` contient : header, modal, footer, scripts communs.
Chaque page étend avec `{% block body %}` et `{% block scripts %}`.

### Modules CSS

```
main.css (point d'entrée @import)
├── variables.css  — tokens CSS (couleurs, rayons, transitions)
├── layout.css     — header, tabs, loader, footer
├── kpi.css        — cartes KPI
├── charts.css     — cartes graphiques
├── tables.css     — tables, badges, barres de progression
├── modal.css      — modal overlay + drilldown chips
└── events.css     — page events (toolbar, onglets sévérité, pagination)
```

**Variables CSS clés** (`variables.css`) :

| Variable        | Valeur par défaut         | Rôle                    |
|-----------------|---------------------------|-------------------------|
| `--bg`          | `#0d1117`                 | Fond principal          |
| `--bg-card`     | `#161b22`                 | Fond des cartes         |
| `--bg-card2`    | `#1c2330`                 | Fond secondaire         |
| `--blue`        | `#3b8beb`                 | Couleur accentuation    |
| `--orange`      | `#f0922b`                 | High severity           |
| `--red`         | `#e84040`                 | Critical severity       |
| `--border`      | `rgba(255,255,255,.08)`   | Bordures                |
| `--radius`      | `10px`                    | Rayon coins cartes      |
| `--radius-sm`   | `6px`                     | Rayon coins petits      |
| `--transition`  | `0.18s cubic-bezier(...)` | Animations              |

---

## 7. Flux de données complet

```
Utilisateur clique "30j"
      │
      ▼
period.js : currentDays = 30
      │ appelle
      ▼
_loadPageData(30, null, null)   [défini dans main.js ou events.js]
      │
      ▼
fetch("/api/metrics?days=30")   ou   fetch("/api/alarms?days=30")
      │
      ▼
app.py : _range_from_days(30) → (date_from, date_to)
      │ vérifie cache
      ▼
logrhythm.compute_metrics(date_from, date_to)
      │
      ├── fetch_alarms() → GET /lr-alarm-api/alarms (paginé, 500/page)
      │       │ filtre Python double-borne
      │       └── retourne liste d'alarmes brutes
      │
      ├── fetch_cases()  → GET /lr-case-api/cases
      │
      └── _compute_from_alarms(alarms, cases)
              │ classify_alarm() pour chaque alarme
              │ agrège compteurs + alarm_list
              └── retourne dict métriques complet
      │
      ▼
Flask → JSON → Browser
      │
      ▼
renderAll(data)   [main.js]  ou  applyFilters()  [events.js]
```

---

## 8. API Flask — Référence des endpoints

### `GET /api/metrics`

Retourne toutes les métriques pour une période.

| Paramètre   | Type    | Défaut | Description                              |
|-------------|---------|--------|------------------------------------------|
| `days`      | int     | 30     | Nb de jours depuis aujourd'hui           |
| `date_from` | string  | —      | Début de plage custom (`YYYY-MM-DD`)     |
| `date_to`   | string  | —      | Fin de plage custom (`YYYY-MM-DD`)       |
| `force`     | bool    | false  | Invalide le cache et recharge depuis LR  |

Priorité : `date_from + date_to` > `days`.

---

### `GET /api/alarms`

Retourne la liste des alarmes filtrées.

| Paramètre   | Type    | Défaut | Description                                                    |
|-------------|---------|--------|----------------------------------------------------------------|
| `severity`  | string  | all    | `all` \| `critical` \| `high` \| `medium` \| `low` \| `intrusion` |
| `days`      | int     | 30     | Même logique que `/api/metrics`                                |
| `date_from` | string  | —      | Plage custom                                                   |
| `date_to`   | string  | —      | Plage custom                                                   |
| `force`     | bool    | false  | Invalide le cache                                              |

Réponse :
```json
{
  "alarms": [...],
  "total": 42,
  "severity": "critical",
  "date_from": "2026-02-08T00:00:00Z",
  "date_to": "2026-03-10T23:59:59Z",
  "last_updated": "2026-03-10T14:00:00Z"
}
```

---

### `GET /api/drilldown/{alarm_id}`

Retourne les hosts/IPs/users d'une alarme (lazy loading depuis la modal).

Réponse :
```json
{
  "sourceHosts": ["host1"],
  "destHosts":   ["server2"],
  "sourceIps":   ["10.0.0.5"],
  "destIps":     ["172.20.1.10"],
  "users":       ["jdoe"],
  "eventCount":  3
}
```

---

## 9. Mode local (fichier JSON)

Pour travailler sans accès à l'API LogRhythm, exporter les données avec `export_alarms.py` puis pointer vers le fichier via `.env`.

**Générer un export** :
```bash
python export_alarms.py
# crée data/alarms_export_YYYYMMDD_HHMM.json
```

**Activer le mode local** dans `.env` :
```
LOCAL_DATA_FILE=alarms_export_20260306_1710.json
```

**Désactiver (mode live)** : commenter la ligne.

Le fichier JSON contient :
```json
{
  "date_from": "...",
  "date_to": "...",
  "exported_at": "...",
  "alarms": [
    {
      "alarm": { ...champs alarme... },
      "events": [ ...events drilldown... ]
    }
  ]
}
```

---

## 10. Guide — Ajouter ou modifier une feature

### Ajouter une nouvelle classification d'intrusion

1. Ouvrir `logrhythm/constants.py`
2. Ajouter dans `LR_CLASSIFICATIONS` avec le RR approprié :
   ```python
   "Ma Classification": 8,
   ```
3. Ajouter dans `INTRUSION_CLASSIFICATIONS` :
   ```python
   INTRUSION_CLASSIFICATIONS = {..., "Ma Classification"}
   ```

---

### Ajouter un nouveau KPI sur le Dashboard

1. **`logrhythm/metrics.py`** — calculer et ajouter la valeur dans le dict retourné par `_compute_from_alarms`
2. **`templates/index.html`** — ajouter une `<div class="kpi-card">` dans le groupe KPI approprié
3. **`static/js/main.js`** — dans `renderKPIs(data)`, lire `data.ma_metrique` et mettre à jour le DOM

---

### Ajouter une colonne dans la table Events

1. **`templates/events.html`** — ajouter un `<th>` dans le `<thead>` et un `<td>` dans le template de ligne
2. **`static/js/events.js`** — dans `renderPage()`, inclure le champ dans la génération du HTML de chaque ligne
3. **`logrhythm/metrics.py`** — si le champ n'est pas déjà dans `alarm_list`, l'ajouter dans le `.append({...})`

---

### Ajouter un nouveau graphique

1. **`templates/index.html`** — ajouter une `<div class="chart-card">` avec un `<canvas id="myChart">`
2. **`static/js/charts.js`** — créer une variable `_myChart = null` et une fonction `renderMyChart(data)` qui initialise/met à jour le Chart.js
3. **`static/js/main.js`** — appeler `renderMyChart(data)` depuis `renderCharts(data)`

---

### Ajouter une nouvelle page

1. **`templates/`** — créer `mapage.html` qui étend `base.html` :
   ```html
   {% extends "base.html" %}
   {% set active_tab = "mapage" %}
   {% block body %}...{% endblock %}
   {% block scripts %}<script src="/static/js/mapage.js"></script>{% endblock %}
   ```
2. **`templates/base.html`** — ajouter le lien dans la nav :
   ```html
   <a href="/mapage" class="header-tab {% if active_tab == 'mapage' %}active{% endif %}">
     <i class="fa-solid fa-..."></i> Ma Page
   </a>
   ```
3. **`app.py`** — ajouter la route Flask :
   ```python
   @app.route("/mapage")
   def mapage():
       return render_template("mapage.html", active_tab="mapage")
   ```
4. **`static/js/mapage.js`** — définir `_loadPageData(days, dateFrom, dateTo)` (requis par `period.js`)

---

### Modifier le seuil de sévérité

Fichier : `logrhythm/constants.py`

```python
RR_CRITICAL = 9   # alarmes RR >= 9 → "critical"
RR_HIGH     = 8   # alarmes RR >= 8 → "high"
```

> Les seuils `medium` (rr≥5) et `low` (rr<5) sont codés en dur dans `metrics.py` — les modifier directement dans `_compute_from_alarms`.

---

### Changer la couleur d'une classification dans les graphiques

Fichier : `static/js/config.js`

```javascript
const CLASSIF_COLORS = {
  "Attack":    "#f0922b",
  "Malware":   "#e84040",
  // ...
};
```

---

*Documentation générée le 2026-03-10*
