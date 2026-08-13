"""
Calcul des métriques SOC depuis l'API ou depuis un fichier JSON local.
"""
import os
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

from .constants import (
    ALARM_STATUS, BACKLOG_STATUSES, FALSE_POS_STATUSES, TRUE_POS_STATUSES,
    INTRUSION_KEYWORDS, MONITORED_ENTITIES,
)
from .classify import classify_alarm, get_severity
from .client import fetch_alarms, fetch_cases


# ── Helpers drilldown ─────────────────────────────────────────────────────────
def _extract_info_from_events(events: list) -> dict:
    """Extrait hosts/IPs/users depuis une liste d'events (mode local)."""
    source_hosts: set = set()
    dest_hosts:   set = set()
    source_ips:   set = set()
    dest_ips:     set = set()
    users:        set = set()
    _EMPTY = {"-", "N/A", "n/a", "none", "None", ""}

    for evt in events:
        if not isinstance(evt, dict):
            continue
        for fld in ("sourceHostName", "logSourceHostName", "originHostName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_hosts.add(v); break
        for fld in ("destinationHostName", "impactedHostName", "destHostName"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_hosts.add(v); break
        for fld in ("sourceIp", "sourceIPAddress", "originIp", "srcIp"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                source_ips.add(v); break
        for fld in ("destinationIp", "destIp", "impactedIp", "dstIp", "destinationIPAddress"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                dest_ips.add(v); break
        for fld in ("userName", "user", "account", "login", "subject"):
            v = evt.get(fld)
            if v and v not in _EMPTY:
                users.add(v); break

    return {
        "sourceHosts": sorted(source_hosts)[:5],
        "destHosts":   sorted(dest_hosts)[:5],
        "sourceIps":   sorted(source_ips)[:5],
        "destIps":     sorted(dest_ips)[:5],
        "users":       sorted(users)[:5],
        "eventCount":  len(events),
    }


# ── Logique commune de calcul ────────────────────────────────────────────────
def _compute_from_alarms(alarms: list, date_from: str, date_to: str, cases: list | None = None) -> dict:
    """
    Calcule toutes les métriques à partir d'une liste d'alarmes brutes.
    Factorisation partagée par compute_metrics() et compute_metrics_from_file().
    """
    if cases is None:
        cases = []

    total           = len(alarms)
    backlog_count   = 0
    false_pos_count = 0
    true_pos_count  = 0
    critical_count  = 0   # backlog RR≥9 (pour la table + bannière)
    high_count      = 0   # backlog RR=8 (pour la table + bannière)
    intrusion_count = 0
    # Distribution de sévérité sur TOUTES les alarmes (pour les KPI Alertes normales)
    sev_critical    = 0   # RR ≥ 9
    sev_high        = 0   # RR = 8
    sev_medium      = 0   # RR 5–7
    sev_low         = 0   # RR < 5

    status_counts  = Counter()
    entity_counts  = Counter()
    rule_counts    = Counter()
    classif_counts = Counter()
    daily_counts   = defaultdict(int)
    daily_crit     = defaultdict(int)
    daily_high     = defaultdict(int)
    daily_medium   = defaultdict(int)
    daily_low      = defaultdict(int)
    entity_daily: dict = defaultdict(lambda: defaultdict(int))
    critical_list  = []
    alarm_list     = []   # toutes les alarmes (pour /api/alarms + page Events)

    intrusion_details = {
        "config_mod": 0,
        "malware": 0,
        "brute_force": 0,
        "web_attack": 0
    }

    for alarm in alarms:
        status_int = alarm.get("alarmStatus", -1)
        status_lbl = ALARM_STATUS.get(status_int, f"Inconnu ({status_int})")
        rule_name  = alarm.get("alarmRuleName", "Unknown")
        entity     = alarm.get("entityName", "Unknown")
        date_ins   = alarm.get("dateInserted", "")
        classification, rr = classify_alarm(alarm)

        status_counts[status_lbl]      += 1
        entity_counts[entity]          += 1
        rule_counts[rule_name]         += 1
        classif_counts[classification] += 1

        if date_ins:
            day = date_ins[:10]
            daily_counts[day] += 1
            entity_daily[entity][day] += 1
            if rr >= 9:   daily_crit[day]   += 1
            elif rr >= 8: daily_high[day]   += 1
            elif rr >= 5: daily_medium[day] += 1
            else:         daily_low[day]    += 1

        if status_int in BACKLOG_STATUSES:   backlog_count   += 1
        if status_int in FALSE_POS_STATUSES: false_pos_count += 1
        if status_int in TRUE_POS_STATUSES:  true_pos_count  += 1

        # Comptage global par sévérité (toutes alarmes, tous statuts)
        if   rr >= 9: sev_critical += 1
        elif rr >= 8: sev_high     += 1
        elif rr >= 5: sev_medium   += 1
        else:         sev_low      += 1

        host = (
            alarm.get("impactedHostName") or alarm.get("hostName")
            or alarm.get("sourceHostName") or alarm.get("destinationHostName")
            or alarm.get("impactedHost")   or alarm.get("hostImpacted") or ""
        )

        sev_label = (
            "critical" if rr >= 9 else
            "high"     if rr >= 8 else
            "medium"   if rr >= 5 else
            "low"
        )

        rule_lower   = rule_name.lower()
        is_intrusion = any(kw in rule_lower for kw in INTRUSION_KEYWORDS)
        rule_name = alarm.get("alarmRuleName", "").lower()
        if is_intrusion:
            # On utilise les noms de clés qui correspondent au JavaScript
            if "config" in rule_name or "modified" in rule_name:
                intrusion_details["config_mod"] += 1
            elif "malware" in rule_name or "virus" in rule_name:
                intrusion_details["malware"] += 1
            elif "brute" in rule_name or "guessing" in rule_name:
                intrusion_details["brute_force"] += 1
            elif any(k in rule_name for k in ["web", "sql", "xss", "http"]):
                intrusion_details["web_attack"] += 1
            
            #intrusion_count += 1

        # Liste complète pour la page Events
        alarm_list.append({
            "alarmId":        alarm.get("alarmId"),
            "alarmRuleName":  rule_name,
            "alarmStatus":    status_lbl,
            "entityName":     entity,
            "hostImpacted":   host,
            "dateInserted":   date_ins,
            "classification": classification,
            "riskRating":     rr,
            "severityLabel":  sev_label,
            "isIntrusion":    is_intrusion,
        })

        severity = get_severity(rr)
        if severity and status_int in BACKLOG_STATUSES:
            if severity == "critical": critical_count += 1
            else:                      high_count     += 1
            if len(critical_list) < 20:
                critical_list.append({
                    "alarmId":        alarm.get("alarmId"),
                    "alarmRuleName":  rule_name,
                    "alarmStatus":    status_lbl,
                    "entityName":     entity,
                    "hostImpacted":   host,
                    "dateInserted":   date_ins,
                    "classification": classification,
                    "riskRating":     rr,
                    "severity":       severity,
                })

        if is_intrusion:
            intrusion_count += 1

    fp_rate = round(false_pos_count / total * 100, 1) if total else 0
    tp_rate = round(true_pos_count  / total * 100, 1) if total else 0

    case_priority = Counter()
    case_status   = Counter()
    for case in cases:
        p = str(case.get("priority", "?"))
        case_priority[p] += 1
        s = case.get("status", {})
        s_name = s.get("name", "?") if isinstance(s, dict) else str(s)
        case_status[s_name] += 1

    sorted_days = sorted(daily_counts)

    return {
        # KPIs
        "total_alarms":        total,
        "critical_alarms":     critical_count,   # backlog uniquement (bannière + table)
        "high_alarms":         high_count,        # backlog uniquement
        "backlog":             backlog_count,
        "false_positive_rate": fp_rate,
        "true_positive_rate":  tp_rate,
        "intrusion_attempts":  intrusion_count,
        "intrusion_details":   intrusion_details,
        # Distribution sévérité — toutes alarmes (KPI "Alertes normales")
        "severity_critical":   sev_critical,
        "severity_high":       sev_high,
        "severity_medium":     sev_medium,
        "severity_low":        sev_low,
        # Distributions
        "by_status":     dict(status_counts.most_common()),
        "top_entities":  dict(entity_counts.most_common(10)),
        "top_rules":     dict(rule_counts.most_common(10)),
        "classifications": dict(classif_counts.most_common()),
        # Séries temporelles
        "daily_labels": sorted_days,
        "daily_counts": [daily_counts[d] for d in sorted_days],
        "daily_by_severity": {
            "Critical": [daily_crit.get(d, 0)   for d in sorted_days],
            "High":     [daily_high.get(d, 0)    for d in sorted_days],
            "Medium":   [daily_medium.get(d, 0)  for d in sorted_days],
            "Low":      [daily_low.get(d, 0)      for d in sorted_days],
        },
        "daily_by_entity": {
            entity: [entity_daily[entity].get(d, 0) for d in sorted_days]
            for entity, _ in entity_counts.most_common(5)
        },
        # Tableau critique (backlog, limité à 20)
        "critical_list": critical_list,
        # Liste complète pour /api/alarms et la page Events
        "alarm_list":    alarm_list,
        # Cases
        "total_cases":        len(cases),
        "cases_by_priority":  dict(case_priority),
        "cases_by_status":    dict(case_status),
        # Métadonnées
        "date_from":    date_from,
        "date_to":      date_to,
    }

# ── API live ──────────────────────────────────────────────────────────────────
def compute_metrics(date_from: str, date_to: str) -> dict:
    """Calcule les métriques en appelant l'API LogRhythm."""
    alarms = fetch_alarms(date_from, date_to)
    if MONITORED_ENTITIES:
        alarms = [a for a in alarms if a.get("entityName") in MONITORED_ENTITIES]
    cases  = fetch_cases(date_from, date_to)
    result = _compute_from_alarms(alarms, date_from, date_to, cases)
    result["last_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return result

# ── Mode local (fichier JSON exporté) ────────────────────────────────────────
def compute_metrics_from_file(filepath: str) -> tuple[dict, dict]:
    """
    Charge un fichier JSON exporté par export_alarms.py.
    Retourne (metrics_dict, drilldown_index {alarm_id: drilldown_data}).
    """
    with open(filepath, encoding="utf-8") as f:
        export = json.load(f)

    date_from  = export.get("date_from", "")
    date_to    = export.get("date_to",   "")
    items      = export.get("alarms", [])

    alarms_raw = [item["alarm"]                       for item in items]
    events_map = {item["alarm"].get("alarmId"): item.get("events", []) for item in items}

    result = _compute_from_alarms(alarms_raw, date_from, date_to)
    result["last_updated"] = export.get("exported_at", "")
    result["local_mode"]   = True
    result["local_file"]   = os.path.basename(filepath)

    drilldown_index = {
        alarm_id: _extract_info_from_events(events)
        for alarm_id, events in events_map.items()
    }

    return result, drilldown_index
#-----save 
def get_top_impacted_host(alarm_list):
    from concurrent.futures import ThreadPoolExecutor
    from collections import Counter
    import logrhythm
    
    relevant_alarms = [a for a in alarm_list if a.get('isIntrusion') or a.get('severityLabel') in ['critical', 'high']]   
    counts = Counter()
    
    # 2. Fonction interne pour récupérer un seul hôte (pour le thread)
    def fetch_host(alarm):
        details = fetch_drilldown(alarm.get('alarmId'))
        if details and details.get('destHosts'):
            return details['destHosts'][0]
        return None

    # 3. On lance les appels en PARALLÈLE (20 à la fois)
    # C'est ici que ça devient crédible : on peut traiter 1000 alarmes en quelques secondes
    with ThreadPoolExecutor(max_workers=20) as executor:
        results = executor.map(fetch_host, relevant_alarms)

    # 4. On compile les résultats
    for host in results:
        if host and host not in ["-", "", "None"]:
            counts[host] += 1

    top_10 = counts.most_common(10)
    
    return {
        "labels": [str(item[0]) for item in top_10],
        "values": [int(item[1]) for item in top_10]
    }

    
#-------------------
def save_and_clean_cache(cache, filepath=CACHE_FILE):
    """Sauvegarde le cache en supprimant les vieilles alertes"""
    current_time = time.time()
    seconds_in_30_days = MAX_AGE_DAYS * 24 * 60 * 60
    
    # On ne garde que ce qui est récent (si on a stocké un timestamp)
    # Ou plus simple : on nettoie si le cache dépasse 10 000 entrées
    if len(cache) > 10000:
        # On garde les 5000 plus récentes (tri par clé si ID est chronologique)
        sorted_keys = sorted(cache.keys())[-50000:]
        cache = {k: cache[k] for k in sorted_keys}

    with open(filepath, "w") as f:
        json.dump(cache, f)