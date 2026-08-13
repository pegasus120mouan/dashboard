# Documentation API LogRhythm

> Basée sur les réponses réelles de l'instance `172.20.200.4`
> Référence officielle : https://developers.exabeam.com/logrhythm-siem

---

## 1. Connexion & Authentification

### Base URL
```
https://<IP_PLATFORM_MANAGER>:8501
```

### Headers obligatoires (toutes les requêtes)
```http
Accept: application/json
Authorization: Bearer <TOKEN_JWT>
```

### Obtenir un token JWT
Le token se génère depuis la **Client Console** LogRhythm :
`Administration > API > Generate Token`

Le token est un JWT avec les champs :
| Champ | Description |
|-------|-------------|
| `uid` | ID utilisateur |
| `sub` | Nom du compte API |
| `rid` | Rôle (ex: `globalAdmin`) |
| `exp` | Expiration (timestamp Unix) |
| `iss` | Émetteur : `lr-auth` |

> ⚠ Le token expire. Vérifier le champ `exp` avant utilisation.
> Décodable sur https://jwt.io (sans envoyer en production)

### Désactiver la vérification SSL (certificats auto-signés)
```python
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
requests.get(url, verify=False)
```

---

## 2. Alarmes — `/lr-alarm-api/alarms`

### 2.1 Lister les alarmes

```
GET https://<IP>:8501/lr-alarm-api/alarms
```

#### Paramètres de requête (query params)

| Paramètre | Type | Obligatoire | Description |
|-----------|------|-------------|-------------|
| `count` | int | Non | Nombre de résultats (défaut : 25, max conseillé : 500) |
| `offset` | int | Non | Décalage pour la pagination (défaut : 0) |
| `orderby` | string | Non | Tri : `DateInserted`, `AlarmRuleName`, `AlarmStatus`, `EntityName` |
| `dir` | string | Non | Direction : `ascending` ou `descending` |
| `dateInserted` | string ISO 8601 | Non | **Borne basse** de date. Retourne les alarmes **à partir** de cette date |
| `alarmStatus` | int | Non | Filtre par statut (voir tableau des statuts ci-dessous) |
| `alarmRuleName` | string | Non | Filtre par nom de règle AIE |
| `entityName` | string | Non | Filtre par nom d'entité |

> ⚠ **Important** : `dateInserted` est une **borne basse uniquement**.
> L'API ne supporte pas de borne haute. Filtrer `<= date_to` côté client.

#### Exemple Python
```python
params = {
    "count":        500,
    "offset":       0,
    "orderby":      "DateInserted",
    "dir":          "descending",
    "dateInserted": "2026-02-01T00:00:00Z",   # depuis cette date
}
response = requests.get(
    "https://172.20.200.4:8501/lr-alarm-api/alarms",
    params=params,
    headers=headers,
    verify=False
)
```

#### Structure de la réponse (réelle)
```json
{
  "alarmsSearchDetails": [
    {
      "alarmId": 47219,
      "alarmRuleName": "AIE: SAH:Lateral: Brute Force Internal Auth Failure",
      "alarmStatus": 0,
      "alarmDataCached": "N",
      "associatedCases": [],
      "entityName": "Domain Controllers",
      "dateInserted": "2026-03-04T09:07:08.667"
    }
  ],
  "alarmsCount": 42,
  "statusCode": 200,
  "statusMessage": "Ok",
  "responseMessage": ""
}
```

#### Champs retournés par la liste
| Champ | Type | Description |
|-------|------|-------------|
| `alarmId` | int | Identifiant unique de l'alarme |
| `alarmRuleName` | string | Nom de la règle AIE déclenchée |
| `alarmStatus` | **int** | Statut (voir tableau ci-dessous) |
| `alarmDataCached` | string | `"Y"` si les données sont en cache, `"N"` sinon |
| `associatedCases` | array | Liste des IDs de cases liés |
| `entityName` | string | Entité LogRhythm source |
| `dateInserted` | string | Date/heure d'insertion (format : `"2026-03-04T09:07:08.667"`) |
| `alarmsCount` | int | Nombre total d'alarmes correspondant au filtre |

> ⚠ **`rbpMax` et `rbpAvg` ne sont PAS dans la réponse de liste.**
> Il faut faire un appel individuel `/alarms/{id}` pour les obtenir.

#### Tableau des statuts `alarmStatus` (entier → texte)
| Valeur | Texte |
|--------|-------|
| `0` | New |
| `1` | Open |
| `2` | Open: Working |
| `3` | Open: Escalated |
| `4` | Closed: False Alarm |
| `5` | Closed: Resolved |
| `6` | Closed: Unresolved |
| `7` | Closed: Reported |
| `8` | Closed: Monitor |

---

### 2.2 Détails d'une alarme

```
GET https://<IP>:8501/lr-alarm-api/alarms/{alarmId}
```

Retourne les champs complets absents de la liste :

| Champ | Type | Description |
|-------|------|-------------|
| `alarmId` | int | Identifiant unique |
| `alarmRuleID` | int | ID de la règle AIE |
| `alarmRuleName` | string | Nom de la règle |
| `alarmStatus` | int | Statut (entier) |
| `entityId` | int | ID de l'entité |
| `entityName` | string | Nom de l'entité |
| `dateInserted` | string | Date de création |
| `dateUpdated` | string | Date de dernière mise à jour |
| `rbpMax` | int | Risk-Based Priority maximum (0–100) |
| `rbpAvg` | int | Risk-Based Priority moyen |
| `eventCount` | int | Nombre d'événements liés |
| `eventDateFirst` | string | Date du premier événement |
| `eventDateLast` | string | Date du dernier événement |
| `associatedCases` | array | Cases associés |
| `smartResponseActions` | array | Actions SmartResponse disponibles |
| `alarmDataCached` | string | `"Y"` / `"N"` |

#### Exemple Python
```python
alarm_id = 47219
response = requests.get(
    f"https://172.20.200.4:8501/lr-alarm-api/alarms/{alarm_id}",
    headers=headers,
    verify=False
)
details = response.json()
rbp_max = details.get("rbpMax")
```

---

### 2.3 Événements d'une alarme

```
GET https://<IP>:8501/lr-alarm-api/alarms/{alarmId}/events
```

Retourne les logs bruts ayant déclenché l'alarme.

| Paramètre | Type | Description |
|-----------|------|-------------|
| `count` | int | Nombre d'événements |
| `get-log-message` | bool | `true` pour inclure le message log complet |

---

### 2.4 Historique d'une alarme

```
GET https://<IP>:8501/lr-alarm-api/alarms/{alarmId}/history
```

Retourne les changements de statut et commentaires.

---

### 2.5 Mettre à jour une alarme

```
PUT https://<IP>:8501/lr-alarm-api/alarms/{alarmId}
```

**Body JSON :**
```json
{
  "alarmStatus": 5,
  "rbpValue": 75
}
```

---

### 2.6 Ajouter un commentaire

```
POST https://<IP>:8501/lr-alarm-api/alarms/{alarmId}/comments
```

**Header supplémentaire :**
```http
Content-Type: application/json
```

**Body JSON :**
```json
{
  "comment": "Analysé et confirmé comme faux positif."
}
```

---

## 3. Cases — `/lr-case-api/cases`

### 3.1 Lister les cases

```
GET https://<IP>:8501/lr-case-api/cases
```

#### Paramètres de requête

| Paramètre | Type | Description |
|-----------|------|-------------|
| `count` | int | Nombre de résultats (défaut : 50) |
| `offset` | int | Pagination |
| `orderBy` | string | `dateCreated`, `dateUpdated`, `dateClosed`, `name`, `number`, `priority`, `dueDate` |
| `direction` | string | `asc` ou `desc` |
| `createdAfter` | string ISO 8601 | Borne basse de date de création |
| `createdBefore` | string ISO 8601 | Borne haute de date de création |
| `updatedAfter` | string ISO 8601 | Filtrer par mise à jour |
| `statusNumber` | int | Filtre par statut |
| `priority` | int | Filtre par priorité (1–5) |
| `text` | string | Recherche par nom ou numéro de case |

#### Exemple Python
```python
params = {
    "count":         200,
    "offset":        0,
    "orderBy":       "dateCreated",
    "direction":     "desc",
    "createdAfter":  "2026-02-01T00:00:00Z",
    "createdBefore": "2026-03-04T23:59:59Z",
}
response = requests.get(
    "https://172.20.200.4:8501/lr-case-api/cases",
    params=params,
    headers=headers,
    verify=False
)
```

#### Champs de la réponse
| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique (UUID) |
| `number` | int | Numéro de case |
| `name` | string | Nom du case |
| `priority` | int | Priorité (1=Critical … 5=Low) |
| `status` | object | `{ "name": "Created" / "Completed" / "Mitigated" }` |
| `dateCreated` | string | Date de création |
| `dateUpdated` | string | Dernière modification |
| `dateClosed` | string | Date de fermeture |
| `owner` | object | Propriétaire du case |
| `summary` | string | Résumé |
| `resolution` | string | Résolution |
| `tags` | array | Tags associés |
| `collaborators` | array | Collaborateurs |

#### Tableau des priorités
| Valeur | Niveau |
|--------|--------|
| `1` | Critical |
| `2` | High |
| `3` | Medium |
| `4` | Low |
| `5` | Informational |

---

### 3.2 Détails d'un case

```
GET https://<IP>:8501/lr-case-api/cases/{caseId}
```

---

### 3.3 Evidence d'un case

```
GET https://<IP>:8501/lr-case-api/cases/{caseId}/evidence
```

---

## 4. Recherche de logs — `/lr-search-api`

La recherche de logs se fait en **2 étapes** : créer une tâche, puis récupérer les résultats.

### Étape 1 — Créer une tâche de recherche

```
POST https://<IP>:8501/lr-search-api/actions/search-task
```

**Headers :**
```http
Accept: application/json
Content-Type: application/json
Authorization: Bearer <TOKEN>
```

**Body JSON :**
```json
{
  "maxMsgsToQuery": 10000,
  "queryTimeout": 60,
  "dateCriteria": {
    "startTime": "2026-02-01T00:00:00Z",
    "endTime":   "2026-03-04T23:59:59Z"
  },
  "queryFilter": {
    "filterGroup": {
      "filterItems": [
        {
          "fieldName": "login",
          "operator":  "contains",
          "value":     "admin"
        }
      ]
    }
  }
}
```

**Réponse :** retourne un `TaskId` (GUID)
```json
{ "TaskId": "a1b2c3d4-..." }
```

### Étape 2 — Récupérer les résultats

```
POST https://<IP>:8501/lr-search-api/actions/search-result
```

**Body JSON :**
```json
{
  "searchGuid": "a1b2c3d4-...",
  "paginator": {
    "pageSize":   100,
    "pageNumber": 1
  }
}
```

**Champs de réponse :**
| Champ | Description |
|-------|-------------|
| `TaskStatus` | `Completed`, `Running`, `Failed` |
| `Items` | Tableau de logs |
| `Total` | Nombre total de résultats |

> ⚠ Si `TaskStatus` est `Running`, attendre et relancer la requête de résultat.

---

## 5. Endpoints récapitulatifs

| Méthode | Endpoint | Usage |
|---------|----------|-------|
| `GET` | `/lr-alarm-api/alarms` | Liste des alarmes avec filtres |
| `GET` | `/lr-alarm-api/alarms/{id}` | Détails + RBP d'une alarme |
| `GET` | `/lr-alarm-api/alarms/{id}/events` | Logs ayant déclenché l'alarme |
| `GET` | `/lr-alarm-api/alarms/{id}/history` | Historique des modifications |
| `PUT` | `/lr-alarm-api/alarms/{id}` | Modifier statut / RBP |
| `POST` | `/lr-alarm-api/alarms/{id}/comments` | Ajouter un commentaire |
| `GET` | `/lr-case-api/cases` | Liste des cases avec filtres |
| `GET` | `/lr-case-api/cases/{id}` | Détails d'un case |
| `GET` | `/lr-case-api/cases/{id}/evidence` | Evidence d'un case |
| `POST` | `/lr-search-api/actions/search-task` | Lancer une recherche de logs |
| `POST` | `/lr-search-api/actions/search-result` | Récupérer les résultats |
| `GET` | `/lr-admin-api/hosts` | Liste des hôtes |
| `GET` | `/lr-admin-api/users` | Liste des utilisateurs |
| `GET` | `/lr-admin-api/networks` | Liste des réseaux |

---

## 6. Points critiques à retenir

| Piège | Explication |
|-------|-------------|
| Port **8501** uniquement | Le port 8443 = Web Console UI, ne répond pas aux appels API JSON |
| `alarmStatus` est un **entier** | Pas une chaîne. `0` = New, `1` = Open, etc. |
| `dateInserted` = borne basse seulement | Filtrer la borne haute côté client |
| `/alarms/summary` n'existe pas | Renvoie une erreur 400 (traite "summary" comme un alarmId) |
| Format date réponse **sans Z** | `"2026-03-04T09:07:08.667"` — pas de timezone. Comparaison lexicographique ISO reste valide |
| `rbpMax` absent de la liste | Présent uniquement dans `GET /alarms/{id}` |
| SSL auto-signé | Utiliser `verify=False` + désactiver les warnings urllib3 |
| Token JWT | Expiration à vérifier (`exp` dans le payload). Regénérer depuis la Client Console |
| Documentation officielle | Redirige vers https://developers.exabeam.com/logrhythm-siem (LogRhythm racheté par Exabeam) |
